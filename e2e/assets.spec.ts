/**
 * アセットの受け口 (Phase 3-1) と配信 (Phase 3-3)、そして**外から中身が入る口が
 * 同じ所有の規則を守っているか** (#65)。
 *
 * 単体テストが見るのは純ロジック (allowlist・署名・クォータの判定) だけで、
 * **R2 と D1 に実際に着地するか**はここでしか確かめられない。加えて、この口は
 * `crypto.subtle` でハッシュを計算してから送る往復なので、**ブラウザから同じ手順で
 * 踏む**ことにも意味がある (3-4 のアップロード UI が通る道そのもの)。
 *
 * ローカルの D1 / R2 は `--persist-to` で実行をまたいで残る。中身が同じなら
 * sha256 も同じになり、2 回目の実行では「まだ無い」状態を作れない。
 * **中身は毎回ランダムにする**。
 */

import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { login, openEditor } from "./helpers";
import {
  ASSETS_ORIGIN,
  FAKE_GITHUB_ORIGIN,
  PREVIEW_ORIGIN,
  WEB_ORIGIN,
} from "./origins";

/** PNG の署名。これが無いと中身の突き合わせで弾かれる。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Asset {
  readonly bytes: number[];
  readonly sha256: string;
  readonly size: number;
}

/** 毎回違う中身の「PNG」を作る。sha256 は独立した実装 (node:crypto) で求める。 */
function makePng(): Asset {
  const bytes = Buffer.concat([Buffer.from(PNG_SIGNATURE), randomBytes(32)]);
  return {
    bytes: Array.from(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}

interface ApiResult {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

/**
 * ページの中から叩く。
 *
 * `page.request` から直接叩くと `Origin` も `Sec-Fetch-Site` も付かず、
 * ログインを見る前に出どころの確認で 403 になる (ADR 0008)。
 */
function claim(page: Page, body: Record<string, unknown>): Promise<ApiResult> {
  return page.evaluate(async (payload) => {
    const response = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null,
    };
  }, body);
}

/** 実体を送る。`digest` を指定すると、中身と違う sha256 で送れる。 */
function upload(
  page: Page,
  asset: Asset,
  options: { digest?: string } = {}
): Promise<ApiResult> {
  return page.evaluate(
    async ({ bytes, digest }) => {
      const response = await fetch(`/api/assets/${digest}`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array(bytes),
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null,
      };
    },
    { bytes: asset.bytes, digest: options.digest ?? asset.sha256 }
  );
}

/** 所有を手放す (3-4b)。 */
function release(page: Page, sha256: string): Promise<ApiResult> {
  return page.evaluate(async (digest) => {
    const response = await fetch(`/api/assets/${digest}`, { method: "DELETE" });
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null,
    };
  }, sha256);
}

/**
 * その blob が自分に何件計上されているか。
 *
 * 合計バイト数で見ないのは、テストが並列に走って**同じ利用者が同時に別のものを
 * 上げる**ため。台帳は (利用者, blob) で 1 行なので、件数で見れば他のテストの
 * アップロードに左右されない。
 */
async function claimCount(page: Page, sha256: string): Promise<number> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/assets");
    return (await response.json()) as {
      assets: { sha256: string }[];
      usage: { bytes: number };
    };
  });
  return result.assets.filter((asset) => asset.sha256 === sha256).length;
}

test.describe("アセットの受け口", () => {
  test("上げる前は無く、上げると入り、次からは転送が要らない", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    const asset = makePng();
    expect(await claimCount(page, asset.sha256)).toBe(0);

    // 1. まだ無いので、中身を送るよう返る。
    const first = await claim(page, {
      sha256: asset.sha256,
      size: asset.size,
      mime: "image/png",
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "missing" });

    // 2. 中身を送ると台帳に載る。sha256 はサーバが自分で計算して照合する。
    const put = await upload(page, asset);
    expect(put.status).toBe(201);
    expect(put.body).toMatchObject({
      asset: { sha256: asset.sha256, size: asset.size, mime: "image/png" },
    });

    // 3. 同じ中身をもう一度申告すると、**転送せずに**済む (ADR 0003 の dedup)。
    const second = await claim(page, {
      sha256: asset.sha256,
      size: asset.size,
      mime: "image/png",
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      status: "stored",
      asset: { sha256: asset.sha256 },
    });

    expect(await claimCount(page, asset.sha256)).toBe(1);
  });

  test("同じ中身を二度送っても二重に計上しない", async ({ page }) => {
    await openEditor(page);
    await login(page);

    const asset = makePng();
    expect((await upload(page, asset)).status).toBe(201);
    expect((await upload(page, asset)).status).toBe(201);

    // 計上が 2 行になると、同じ素材を上げ直すたびに残り容量が減っていく。
    expect(await claimCount(page, asset.sha256)).toBe(1);
  });

  test("中身と sha256 が食い違う要求は捨てる", async ({ page }) => {
    await openEditor(page);
    await login(page);

    const asset = makePng();
    const other = makePng();

    // 送り手が「どの blob を上書きするか」を選べてしまうと、content-addressed の
    // 不変性が根本から崩れる。ここが最後の砦。
    const result = await upload(page, asset, { digest: other.sha256 });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "digest_mismatch" });

    // 捨てた要求が台帳に残っていないこと。
    const check = await claim(page, {
      sha256: other.sha256,
      size: other.size,
      mime: "image/png",
    });
    expect(check.body).toMatchObject({ status: "missing" });
  });

  test("画像と偽った HTML は受け取らない", async ({ page }) => {
    await openEditor(page);
    await login(page);

    const html = Buffer.from(
      `<!doctype html><script>alert(${Math.trunc(performance.now())})</script>`
    );
    const asset: Asset = {
      bytes: Array.from(html),
      sha256: createHash("sha256").update(html).digest("hex"),
      size: html.length,
    };

    const result = await upload(page, asset);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "content_mismatch" });
  });

  test("allowlist の外の形式は受け取らない", async ({ page }) => {
    await openEditor(page);
    await login(page);

    // SVG は文書として解釈される形式なので、初期の allowlist に入れていない。
    // 形式は本文を読む前に見るので、本文は要らない。**付けない**のは #38 の回避
    // (弾く要求に本文を付けると CI の wrangler dev が落ちる。この形で実際に落ちた)。
    const result = await page.evaluate(async (sha256) => {
      const response = await fetch(`/api/assets/${sha256}`, {
        method: "PUT",
        headers: { "Content-Type": "image/svg+xml" },
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null,
      };
    }, makePng().sha256);

    expect(result.status).toBe(415);
    expect(result.body).toMatchObject({ error: "unsupported_type" });
  });

  test("未ログインでは上げられない", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async () => {
      const response = await fetch(`/api/assets/${"a".repeat(64)}`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
      });
      return { status: response.status };
    });

    expect(result.status).toBe(401);
  });

  test("実行オリジンからのアップロードは 403 で弾く", async ({ page }) => {
    // 他者コードが動くオリジンは same-site なので cookie が付く。ここで止まらなければ、
    // 実行中のスケッチがログイン中の利用者の容量を勝手に使える (ADR 0008)。
    // 弾かれる想定の要求に本文を付けないのは #38 の回避。
    const response = await page.request.put(`/api/assets/${"a".repeat(64)}`, {
      headers: { Origin: PREVIEW_ORIGIN, "Content-Type": "image/png" },
    });

    expect(response.status()).toBe(403);
  });

  test("未ログインでは一覧も引けない", async ({ page }) => {
    const response = await page.request.get("/api/assets");

    expect(response.status()).toBe(401);
  });

  test("手放すと計上から外れ、実体は残る", async ({ page }) => {
    await openEditor(page);
    await login(page);

    const asset = makePng();
    await claim(page, {
      sha256: asset.sha256,
      size: asset.size,
      mime: "image/png",
    });
    await upload(page, asset);
    expect(await claimCount(page, asset.sha256)).toBe(1);

    const released = await release(page, asset.sha256);
    expect(released.status).toBe(200);
    expect(await claimCount(page, asset.sha256)).toBe(0);

    // 実体は消さない (回収は 3-5 の GC)。**まだ配れる**ことが、公開済みの作品を
    // 巻き込まない根拠になっている。
    const delivered = await page.request.get(
      `${ASSETS_ORIGIN}/a/${asset.sha256}/cat.png`
    );
    expect(delivered.status()).toBe(200);

    // 二度目は「持っていない」。消えたつもりが別物だった、を黙らせない。
    expect((await release(page, asset.sha256)).status).toBe(404);
  });

  test("持っていないものと形の違う鍵は手放せない", async ({ page }) => {
    await openEditor(page);
    await login(page);

    expect((await release(page, makePng().sha256)).status).toBe(404);
    expect((await release(page, "not-a-digest")).status).toBe(400);
  });

  test("未ログイン・実行オリジンからは手放せない", async ({ page }) => {
    await page.goto("/");
    expect((await release(page, "a".repeat(64))).status).toBe(401);

    // 実行中のスケッチがログイン中の利用者のアセットを消せてはいけない (ADR 0008)。
    const response = await page.request.delete(
      `/api/assets/${"a".repeat(64)}`,
      { headers: { Origin: PREVIEW_ORIGIN } }
    );
    expect(response.status()).toBe(403);
  });
});

/**
 * 種として置いてあるアセット (playwright.config.ts の SEED_BLOB)。
 *
 * 中身は `e2e/fixtures/dot.png` (2x1 の PNG)。幅と高さを違えてあるので、
 * 取り違えたら数で分かる。
 */
const SEED_ASSET_NAME = "cat.png";
const SEED_ASSET_SKETCH = "E2EAssetSketch01";
const SEED_AUTHOR = "e2e-author";
/** 種の実体の sha256 (playwright.config.ts が同じ値で R2 へ置く)。 */
const SEED_BLOB_SHA256 =
  "7c12c1f9323964065d6b659ec1fe67544707644bf1ce287b9b1c195250adfdfe";

/** srcdoc のスケッチ文書から、画像が読めているかを集める。 */
async function readAssetState(page: Page): Promise<{
  written: number | null;
  writtenSrc: string | null;
  assigned: string | null;
} | null> {
  for (const frame of page.frames()) {
    if (frame.url() !== "about:srcdoc") continue;
    try {
      const state = await frame.evaluate(() => {
        const written = document.getElementById(
          "written"
        ) as HTMLImageElement | null;
        const assigned = document.getElementById(
          "assigned"
        ) as HTMLImageElement | null;
        if (written === null) return null;
        return {
          written: written.naturalWidth,
          writtenSrc: written.src,
          assigned: assigned?.dataset.width ?? null,
        };
      });
      if (state !== null) return state;
    } catch {
      // 差し替えの途中でフレームが外れた。次の呼び出しで見直す。
    }
  }
  return null;
}

test.describe("アセットの配信", () => {
  test("上げた実体を配信オリジンから取れる", async ({ page, request }) => {
    await openEditor(page);
    await login(page);

    const asset = makePng();
    expect((await upload(page, asset)).status).toBe(201);

    const response = await request.get(
      `${ASSETS_ORIGIN}/a/${asset.sha256}/cat.png`
    );

    expect(response.status()).toBe(200);
    expect(Array.from(await response.body())).toEqual(asset.bytes);

    const headers = response.headers();
    expect(headers["content-type"]).toBe("image/png");
    // 中身が変わらないキーなので、上限まで効かせる (ADR 0014)。
    expect(headers["cache-control"]).toContain("immutable");
    // 他者の中身を返す口。申告した形式以外に解釈させない (要件 5.1)。
    expect(headers["x-content-type-options"]).toBe("nosniff");
    // 実行 iframe は別オリジン。p5 は画像に crossOrigin を付ける。
    expect(headers["access-control-allow-origin"]).toBe("*");
    expect(headers["etag"]).toBeTruthy();
  });

  test("同じ ETag で訊き直すと 304、範囲を指定すると 206", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    await login(page);

    const asset = makePng();
    expect((await upload(page, asset)).status).toBe(201);
    const url = `${ASSETS_ORIGIN}/a/${asset.sha256}/cat.png`;

    const first = await request.get(url);
    const etag = first.headers()["etag"] ?? "";
    expect(etag).not.toBe("");

    const revalidated = await request.get(url, {
      headers: { "If-None-Match": etag },
    });
    expect(revalidated.status()).toBe(304);

    // 音声のシークが効くために要る (ADR 0014)。
    const ranged = await request.get(url, { headers: { Range: "bytes=0-3" } });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()["content-range"]).toBe(`bytes 0-3/${asset.size}`);
    expect(Array.from(await ranged.body())).toEqual(asset.bytes.slice(0, 4));
  });

  test("知らない実体と形の違う鍵は 404", async ({ request }) => {
    expect(
      (
        await request.get(`${ASSETS_ORIGIN}/a/${"c".repeat(64)}/cat.png`)
      ).status()
    ).toBe(404);
    // 大文字を許すと同じ中身が 2 つの鍵で載る (ADR 0003)。配信側でも縛る。
    expect(
      (
        await request.get(`${ASSETS_ORIGIN}/a/${"C".repeat(64)}/cat.png`)
      ).status()
    ).toBe(404);
    expect(
      (await request.get(`${ASSETS_ORIGIN}/a/not-a-digest/cat.png`)).status()
    ).toBe(404);
  });

  test("2 つのホストは出すものが混ざらない", async ({ request }) => {
    // 本体のホストから他者のアセットを配らない。
    expect(
      (await request.get(`${WEB_ORIGIN}/a/${"a".repeat(64)}/cat.png`)).status()
    ).toBe(404);
    // 配信のホストで本体の画面や口を開かない (ADR 0014)。
    expect((await request.get(`${ASSETS_ORIGIN}/edit`)).status()).toBe(404);
    expect((await request.get(`${ASSETS_ORIGIN}/api/assets`)).status()).toBe(
      404
    );
  });

  test("種のマニフェストと実体の sha256 が一致している", async () => {
    // ずれていると配信も実行も静かに 404 になる。**種の側で**気付けるようにする。
    const bytes = await readFile(
      fileURLToPath(new URL("fixtures/dot.png", import.meta.url))
    );
    const manifest = JSON.parse(
      await readFile(
        fileURLToPath(new URL("seed-content-assets.json", import.meta.url)),
        "utf8"
      )
    ) as Record<string, string>;
    const entry = JSON.parse(manifest["assets.json"] ?? "{}") as {
      assets: Record<string, { sha256: string; size: number }>;
    };

    expect(entry.assets[SEED_ASSET_NAME]).toMatchObject({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    });
  });

  test("アセットを使う作品は、閲覧画面で画像まで読める", async ({ page }) => {
    await page.goto(`/@${SEED_AUTHOR}/${SEED_ASSET_SKETCH}`);

    await expect
      .poll(() => readAssetState(page), {
        message: "スケッチの画像が読めていません",
        timeout: 15_000,
      })
      .toEqual({
        // index.html の src を書き換える道。
        written: 2,
        writtenSrc: `${ASSETS_ORIGIN}/a/${SEED_BLOB_SHA256}/${SEED_ASSET_NAME}`,
        // img.src への代入を捉える道 (p5 の loadImage が通る形 — ADR 0014)。
        assigned: "2",
      });
  });
});

/** 種の実体の大きさ (`fixtures/dot.png`)。マニフェストにはこの値を書く。 */
const SEED_BLOB_SIZE = 70;

/** 取り込む相手の最小構成。実行の起点が無い Gist は所有を見る前に断られる。 */
const ADOPTED_INDEX_HTML =
  '<!doctype html>\n<html lang="ja">\n  <body>\n    <img src="cat.png" alt="" />\n  </body>\n</html>\n';

/**
 * 偽 GitHub に Gist を直接作る。
 *
 * **保存経路 (UI) を通さずに用意する**。通すとマニフェストの検査で先に弾かれ、
 * 「外にある Gist を取り込む」という別の口を踏めない。資格は形しか見られない
 * (`fake-github/server.ts` の `hasCredentials`)。
 */
async function createGist(
  request: APIRequestContext,
  files: Record<string, string>
): Promise<string> {
  const response = await request.post(`${FAKE_GITHUB_ORIGIN}/gists`, {
    headers: { Authorization: "Basic e2e" },
    data: {
      description: "取り込みの相手 — p5stage",
      public: false,
      files: Object.fromEntries(
        Object.entries(files).map(([name, content]) => [name, { content }])
      ),
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** アセット 1 件だけを持つ assets.json。手で書けることがこの穴の前提だった。 */
function manifestWith(name: string, sha256: string, size: number): string {
  return `${JSON.stringify(
    { version: 1, assets: { [name]: { sha256, size, mime: "image/png" } } },
    null,
    2
  )}\n`;
}

function adopt(page: Page, gistId: string): Promise<ApiResult> {
  return page.evaluate(async (gist) => {
    const response = await fetch("/api/sketches/adopt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gist }),
    });
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null,
    };
  }, gistId);
}

/**
 * 取り込み (adopt) にも同じ所有の規則が掛かること (#65)。
 *
 * 取り込みは**その Gist をそのまま正本にする**操作なので (ADR 0012)、受け入れた
 * 中身は保存を経ずに R2 の写し・参照台帳・配信のポインタまで進む。配信
 * (`/a/<sha256>/<name>`) は D1 を引かないため、素通しすると**実際に配られる**。
 */
test.describe("取り込みとアセットの所有", () => {
  test("他人の実体を指すマニフェストごと取り込むことはできない", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    await login(page);

    // 種の実体は誰の所有でもない (`seed.sql` が `user_blobs` を落としてある) が、
    // R2 には在って配信もされている。sha256 は他人の作品ページから読める値なので、
    // 書き写して自分の Gist に置くのは誰にでもできる。
    const gistId = await createGist(request, {
      "index.html": ADOPTED_INDEX_HTML,
      "assets.json": manifestWith(
        SEED_ASSET_NAME,
        SEED_BLOB_SHA256,
        SEED_BLOB_SIZE
      ),
    });

    const result = await adopt(page, gistId);

    // 要求の形は正しく、使えないのは相手の Gist の方 (保存経路の 400 と違う理由)。
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: "unknown_asset" });
    // クライアントはこの文言をそのまま出す。空だと理由が消える。
    expect(String(result.body?.message ?? "")).not.toBe("");

    // **自動で自分のものとして計上もしない**。ここを計上に倒すと、フォークの系譜
    // (#44 / Phase 4) を通らずに他人の blob を自分の枠へ移せてしまう。
    expect(await claimCount(page, SEED_BLOB_SHA256)).toBe(0);
  });

  test("自分で持ち込んだ実体を指すマニフェストなら取り込める", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    await login(page);

    // 断る側を厳しくしすぎると、**自分の作品を持ち帰る道**まで塞がる。
    const asset = makePng();
    expect((await upload(page, asset)).status).toBe(201);

    const gistId = await createGist(request, {
      "index.html": ADOPTED_INDEX_HTML,
      "assets.json": manifestWith(SEED_ASSET_NAME, asset.sha256, asset.size),
    });

    const result = await adopt(page, gistId);

    expect(result.status).toBe(201);
    // 取り込みで計上が増えない (持ち込んだ 1 行のまま)。
    expect(await claimCount(page, asset.sha256)).toBe(1);
  });

  test("読めない assets.json を持つ Gist は取り込めない", async ({
    page,
    request,
  }) => {
    await openEditor(page);
    await login(page);

    // 受け入れると、次の保存が必ず断られる作品が D1 に残る (保存経路は同じ検査を
    // 通す)。取り込む前なら、利用者は手元の Gist を直せる。
    const gistId = await createGist(request, {
      "index.html": ADOPTED_INDEX_HTML,
      "assets.json": "{ これは JSON ではない",
    });

    const result = await adopt(page, gistId);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: "invalid_manifest" });
    expect(String(result.body?.message ?? "")).toContain("assets.json");
  });
});
