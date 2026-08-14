/**
 * アセットパネル (Phase 3-4)。
 *
 * ここでしか確かめられないのは、**持ち込みが端から端まで繋がっているか**。
 * ブラウザで sha256 を計算し (`crypto.subtle`)、申告して、実体を送り、
 * `assets.json` へ書き戻し、**配信オリジンから見本が読める**ところまでが 1 本の道で、
 * 途中のどこが切れても単体テストは緑のまま通る。
 *
 * ローカルの D1 / R2 は `--persist-to` で実行をまたいで残るため、中身が同じなら
 * sha256 も同じになる。**中身は毎回ランダムにする** (assets.spec.ts と同じ理由)。
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  assetRow,
  assetsDrawer,
  login,
  openAssets,
  openEditor,
  openOwnedAssets,
  ownedAssetRow,
  readStoredDraft,
  toasts,
} from "./helpers";
import { ASSETS_ORIGIN } from "./origins";

/** 2x1 の PNG。見本が**実際に描けるか**まで見るので、本物の画像を種にする。 */
const DOT_PNG = readFileSync(
  fileURLToPath(new URL("fixtures/dot.png", import.meta.url))
);

interface Asset {
  readonly bytes: number[];
  readonly sha256: string;
}

/**
 * 毎回違う中身の PNG。sha256 は独立した実装 (node:crypto) で求める。
 *
 * 種の PNG の**後ろ**に乱数を足す。PNG の復号は `IEND` で終わるので画像としては
 * そのまま読め (見本の確認に要る)、鍵だけが毎回変わる — ローカルの R2 / D1 は
 * `--persist-to` で実行をまたいで残るため、同じ中身では「まだ無い」状態を作れない。
 */
function makePng(): Asset {
  const bytes = Buffer.concat([DOT_PNG, randomBytes(16)]);
  return {
    bytes: Array.from(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** ファイル選択から取り込む。 */
function pickFile(page: Page, asset: Asset, name: string): Promise<void> {
  return page.locator("#assets-picker").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(asset.bytes),
  });
}

/**
 * 画面にファイルを落とす。
 *
 * 掴んで運ぶ動きは Playwright から起こせないので、窓が受け取る `drop` を
 * そのまま組み立てる。**確かめたいのは受け口**で、`preventDefault` を欠かすと
 * ブラウザがファイルを開いて画面ごと飛ぶ箇所でもある。
 */
function dropFile(page: Page, asset: Asset, name: string): Promise<void> {
  return page.evaluate(
    ({ bytes, fileName }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], fileName, { type: "image/png" })
      );
      window.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        })
      );
    },
    { bytes: asset.bytes, fileName: name }
  );
}

/** 下書きに載った `assets.json` (エディタが持つ中身と同じもの)。 */
async function draftManifest(page: Page): Promise<Record<string, unknown>> {
  const draft = (await readStoredDraft(page)) as {
    files?: Record<string, string>;
  } | null;
  const text = draft?.files?.["assets.json"];
  return text === undefined
    ? {}
    : (JSON.parse(text) as Record<string, unknown>);
}

/** マニフェストに載っているアセットの名前。 */
async function draftAssetNames(page: Page): Promise<string[]> {
  const manifest = await draftManifest(page);
  const assets = (manifest.assets ?? {}) as Record<string, unknown>;
  return Object.keys(assets).sort();
}

test.describe("アセットパネル", () => {
  test("落としたファイルが作品のアセットになる", async ({ page }) => {
    await openEditor(page);
    await login(page);

    const asset = makePng();
    await dropFile(page, asset, "cat.png");

    // 落とした先が見えるように、閉じていたドロワーは自分で開く。
    await expect(assetsDrawer(page)).toBeVisible();
    await expect(assetRow(page, "cat.png")).toBeVisible();
    await expect(toasts(page, "success")).toContainText("追加しました");

    // 見本は配信オリジンから読む (ADR 0014)。**読めていること**まで見る —
    // URL を組み立てるだけなら壊れていても画面には出る。
    const thumbnail = assetRow(page, "cat.png").locator("img");
    await expect(thumbnail).toHaveAttribute(
      "src",
      `${ASSETS_ORIGIN}/a/${asset.sha256}/cat.png`
    );
    await expect
      .poll(() =>
        thumbnail.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth
        )
      )
      .toBeGreaterThan(0);

    // 書き戻し先は `assets.json` 1 つ。下書きに載る = エディタのファイルになっている。
    await expect
      .poll(() => draftManifest(page))
      .toMatchObject({
        version: 1,
        assets: { "cat.png": { sha256: asset.sha256, mime: "image/png" } },
      });

    // 使用量も更新される (足したのに 0 のままだと、上限に気付けない)。
    const quota = assetsDrawer(page).locator(".assets-quota-text");
    await expect(quota).toContainText("使用中");
  });

  test("同じ中身は二度並ばず、同じ名前の別の中身は別名になる", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);
    await openAssets(page);

    const first = makePng();
    await pickFile(page, first, "cat.png");
    await expect(assetRow(page, "cat.png")).toBeVisible();

    // 同じものを二度落としただけ。名前を増やすと、参照されないアセットが溜まる。
    await pickFile(page, first, "cat.png");
    await expect(assetsDrawer(page).locator(".assets-row")).toHaveCount(1);

    // 中身が違えば別のアセット。上書きすると loadImage("cat.png") が黙って
    // 別の絵に変わる。
    const second = makePng();
    await pickFile(page, second, "cat.png");
    await expect(assetRow(page, "cat-2.png")).toBeVisible();

    await expect
      .poll(() => draftAssetNames(page))
      .toEqual(["cat-2.png", "cat.png"]);
  });

  test("作品から外すと一覧からもマニフェストからも消える", async ({ page }) => {
    await openEditor(page);
    await login(page);
    await openAssets(page);

    await pickFile(page, makePng(), "cat.png");
    await expect(assetRow(page, "cat.png")).toBeVisible();

    await assetRow(page, "cat.png").locator(".assets-remove").click();

    await expect(assetRow(page, "cat.png")).toHaveCount(0);
    await expect.poll(() => draftAssetNames(page)).toEqual([]);
    // 空になっても `assets.json` 自体は残す (「全部外した」と「一度も使って
    // いない」は別物 — 3-5 の GC がこの区別で参照を数える)。
    await expect.poll(() => draftManifest(page)).toMatchObject({ version: 1 });
  });

  test("作品から外したアセットは持ったままで、削除すると手放せる", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);
    await openAssets(page);

    const asset = makePng();
    await pickFile(page, asset, "cat.png");
    await expect(assetRow(page, "cat.png")).toBeVisible();

    await openOwnedAssets(page);
    const owned = ownedAssetRow(page, asset.sha256);
    await expect(owned).toBeVisible();
    // 使っている間は手放せない。手放すと**次の保存で断られる** (3-2) ので、
    // 気付けない壊れ方になる。
    await expect(owned.locator(".assets-owned-release")).toHaveCount(0);
    await expect(owned.locator(".assets-owned-used")).toContainText("cat.png");

    // 作品から外しても所有は残る (ここが 3-4a との違い)。
    await assetRow(page, "cat.png").locator(".assets-remove").click();
    await expect(assetRow(page, "cat.png")).toHaveCount(0);
    await expect(owned).toBeVisible();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("容量を空けます");
      void dialog.accept();
    });
    await owned.locator(".assets-owned-release").click();

    // 台帳から自分の行が消えた = クォータが空いた。**合計の数字では確かめない** —
    // E2E は同じ利用者で並列に走るので、他のテストのアップロードで動く (3-1)。
    await expect(owned).toHaveCount(0);
    // 「外しました」の知らせがまだ残っているので、最後の 1 枚を見る。
    await expect(toasts(page, "info").last()).toContainText("削除しました");

    // 引き直しても戻らない (画面の中だけで消えたのではない)。
    await page.reload();
    await openAssets(page);
    // **一覧を引き終えてから**見る。読む前の「まだ何も無い」を答えと取り違えない。
    await expect(
      assetsDrawer(page).locator(".assets-quota-text")
    ).toContainText("使用中");
    await expect(ownedAssetRow(page, asset.sha256)).toHaveCount(0);
  });

  test("削除をやめたら手放さない", async ({ page }) => {
    await openEditor(page);
    await login(page);
    await openAssets(page);

    const asset = makePng();
    await pickFile(page, asset, "cat.png");
    await expect(assetRow(page, "cat.png")).toBeVisible();
    await assetRow(page, "cat.png").locator(".assets-remove").click();

    await openOwnedAssets(page);
    const owned = ownedAssetRow(page, asset.sha256);

    page.once("dialog", (dialog) => void dialog.dismiss());
    await owned.locator(".assets-owned-release").click();

    await expect(owned).toBeVisible();
    // 断った後もまた押せる (押した拍子に無効のまま残らない)。
    await expect(owned.locator(".assets-owned-release")).toBeEnabled();
  });

  test("未ログインでは追加できないことを先に言う", async ({ page }) => {
    await openEditor(page);
    await openAssets(page);

    // エディタ自体はログイン無しで使える (要件 3.1)。開けるが、足せない。
    await expect(
      assetsDrawer(page).locator(".assets-quota-text")
    ).toContainText("ログインすると");

    await pickFile(page, makePng(), "cat.png");

    await expect(toasts(page, "error")).toContainText("ログイン");
    await expect(assetRow(page, "cat.png")).toHaveCount(0);
  });
});
