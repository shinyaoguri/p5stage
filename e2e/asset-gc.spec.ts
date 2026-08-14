/**
 * 孤児 blob の回収 (Phase 3-5b)。
 *
 * 回収は Cron からしか走らず、判断の材料は D1 と R2 の**両方**にある — 台帳の 2 つの表
 * (所有・参照) と、R2 に残っているリビジョンの中身。単体テストは猶予の計算までしか
 * 見られないので、**消えてよいものだけが消える**ことはここでしか確かめられない。
 *
 * `wrangler dev --test-scheduled` が開く `/__scheduled` から起こす。猶予は
 * `ASSET_GC_GRACE_HOURS` を短く上書きしてある (playwright.config.ts)。
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  assetRow,
  clearStoredDraft,
  closeAssets,
  login,
  openAssets,
  openEditor,
  openOwnedAssets,
  ownedAssetRow,
  saveAgain,
  saveNewSketch,
  toasts,
} from "./helpers";
import { ASSETS_ORIGIN, WEB_ORIGIN } from "./origins";

/**
 * 猶予が過ぎるまでの待ち (ミリ秒)。
 *
 * playwright.config.ts の `ASSET_GC_GRACE_HOURS` (約 7 秒) より確実に長く取る。
 * 猶予そのものを 0 にしないのは、**E2E が同じ利用者で並列に走る**ため — 他のテストが
 * 手放した直後の実体まで巻き込んで消してしまう。
 */
const GRACE_WAIT_MS = 9_000;

/** 2x1 の PNG。中身は毎回変える (ローカルの D1 / R2 は実行をまたいで残る)。 */
const DOT_PNG = readFileSync(
  fileURLToPath(new URL("fixtures/dot.png", import.meta.url))
);

interface Asset {
  readonly bytes: number[];
  readonly sha256: string;
}

function makePng(): Asset {
  const bytes = Buffer.concat([DOT_PNG, randomBytes(16)]);
  return {
    bytes: Array.from(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** ファイル選択から取り込む (パネル経由 — 3-4a)。 */
function pickFile(page: Page, asset: Asset, name: string): Promise<void> {
  return page.locator("#assets-picker").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(asset.bytes),
  });
}

/**
 * 回収を 1 回起こす。
 *
 * `/__scheduled` は `wrangler dev --test-scheduled` が差し込む口で、本番には無い。
 * 回収に外から起こす口は無い (判断の材料は全部サーバ側にあり、利用者が起こす理由も
 * 無い) ので、実ブラウザから踏めるのはこの形だけ。
 */
async function runGc(page: Page): Promise<void> {
  const response = await page.request.get(`${WEB_ORIGIN}/__scheduled`);
  expect(response.status()).toBe(200);
}

/** 配信オリジンから引けるか (ADR 0014)。回収されたかはここで見る。 */
async function deliveredStatus(page: Page, sha256: string): Promise<number> {
  const response = await page.request.get(
    `${ASSETS_ORIGIN}/a/${sha256}/cat.png`
  );
  return response.status();
}

/** 申告 (claim) の答え。転送を省けるかはここで決まる (3-1)。 */
function claimStatus(page: Page, asset: Asset): Promise<string> {
  return page.evaluate(async (sha256) => {
    const response = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha256, size: 1, mime: "image/png" }),
    });
    const body = (await response.json()) as { status?: string };
    return body.status ?? "";
  }, asset.sha256);
}

/**
 * 持ち込んですぐ手放した実体を 1 つ作る (API 経由)。
 *
 * ページの中から叩くのは、`Origin` も `Sec-Fetch-Site` も無い要求が出どころの確認で
 * 断られるため (ADR 0008)。
 */
async function orphanViaApi(page: Page): Promise<string> {
  const asset = makePng();
  const done = await page.evaluate(
    async ({ bytes, sha256 }) => {
      const body = new Uint8Array(bytes);
      await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sha256,
          size: body.byteLength,
          mime: "image/png",
        }),
      });
      const put = await fetch(`/api/assets/${sha256}`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body,
      });
      const released = await fetch(`/api/assets/${sha256}`, {
        method: "DELETE",
      });
      return put.status === 201 && released.status === 200;
    },
    { bytes: asset.bytes, sha256: asset.sha256 }
  );

  expect(done).toBe(true);
  return asset.sha256;
}

/**
 * 回収が**実際に回りきる**まで起こす。
 *
 * 捨て駒を 1 つ作り、それが消えるまで待つ。1 回の起動で回収まで進むとは限らない —
 * 台帳のバックフィルが済んでいなければその回は埋めるだけで終わる (溜まったリビジョンの
 * 数だけ回数が要る)。「消えないこと」を見るテストが**まだ回収が走っていないだけ**の
 * 状態で通ってしまわないよう、先にこれを通す。
 */
async function sweepUntilCollected(page: Page): Promise<void> {
  const orphan = await orphanViaApi(page);
  await page.waitForTimeout(GRACE_WAIT_MS);

  await expect
    .poll(
      async () => {
        await runGc(page);
        return deliveredStatus(page, orphan);
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBe(404);
}

test.describe("孤児 blob の回収", () => {
  test("手放した実体は、猶予を過ぎてから消える", async ({ page }) => {
    await openEditor(page);
    await login(page);

    // 回収が回りきる状態にしてから始める。そうしないと、この後の「まだ消えない」が
    // 猶予のおかげなのか、単に回収がまだ走っていないだけなのか区別できない。
    await sweepUntilCollected(page);

    // 持ち込んで、どの作品にも入れないまま手放す = 誰にも計上されず、どの
    // リビジョンからも参照されていない実体。回収の対象そのもの。
    await openAssets(page);
    const asset = makePng();
    await pickFile(page, asset, "cat.png");
    await expect(assetRow(page, "cat.png")).toBeVisible();
    await assetRow(page, "cat.png").locator(".assets-remove").click();

    await openOwnedAssets(page);
    const owned = ownedAssetRow(page, asset.sha256);
    page.once("dialog", (dialog) => void dialog.accept());
    await owned.locator(".assets-owned-release").click();
    await expect(owned).toHaveCount(0);

    // 手放した直後の回収では印が付くだけ。**取り返しがつく間がある**ことが猶予の
    // 意味で、ここが効かないと「消したつもりが違った」に手が無くなる。
    await runGc(page);
    expect(await deliveredStatus(page, asset.sha256)).toBe(200);

    await page.waitForTimeout(GRACE_WAIT_MS);
    await runGc(page);
    expect(await deliveredStatus(page, asset.sha256)).toBe(404);

    // 台帳からも落ちている = もう一度持ち込める。実体を消したのに「もう有る」と
    // 答えると、転送を省いた結果**中身だけ存在しない**作品ができる。
    expect(await claimStatus(page, asset)).toBe("missing");
  });

  test("公開済みのリビジョンが参照する実体は、誰も所有していなくても残る", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    // 種のアセット (e2e/seed.sql)。所有は無く、参照も**台帳には無い** —
    // 3-5a より前に書き出されたリビジョンと同じ形で R2 に置いてある。
    // バックフィルが効かなければ孤児と見なされて消える。
    const seedSha256 =
      "7c12c1f9323964065d6b659ec1fe67544707644bf1ce287b9b1c195250adfdfe";

    await sweepUntilCollected(page);

    expect(await deliveredStatus(page, seedSha256)).toBe(200);
  });

  test("一度でも保存した作品が使った実体は、外して手放した後も残る", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);
    await openAssets(page);

    const asset = makePng();
    await pickFile(page, asset, "cat.png");
    await expect(assetRow(page, "cat.png")).toBeVisible();
    await closeAssets(page);
    // 保存して初めて参照になる (R2 へ書き出したリビジョンが台帳に載る — 3-5a)。
    await saveNewSketch(page, `回収 ${randomUUID()}`, "unlisted");

    // 作品から外して保存すれば手放せる (手放しの判断は**今**配信している
    // リビジョンだけを見る — 3-5a)。
    await openAssets(page);
    await assetRow(page, "cat.png").locator(".assets-remove").click();
    await expect(assetRow(page, "cat.png")).toHaveCount(0);
    await closeAssets(page);
    await saveAgain(page);

    await openAssets(page);
    await openOwnedAssets(page);
    const owned = ownedAssetRow(page, asset.sha256);
    page.once("dialog", (dialog) => void dialog.accept());
    await owned.locator(".assets-owned-release").click();
    await expect(toasts(page, "info").last()).toContainText("削除しました");

    // ここからが 3-5b。**過去のリビジョンはまだ配りうる** (R2 に残り、作品ページの
    // 履歴から引ける) ので、回収は全期間の参照を見る。手放した = 誰の所有でも
    // なくなっただけで、消してよい理由にはならない。
    await clearStoredDraft(page);
    await sweepUntilCollected(page);

    expect(await deliveredStatus(page, asset.sha256)).toBe(200);
  });
});
