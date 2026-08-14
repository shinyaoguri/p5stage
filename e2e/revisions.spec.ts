/**
 * リビジョン履歴の閲覧 (Phase 4-1 / ADR 0016)。
 *
 * ここでしか確かめられないのは 2 つ。**過去の版が当時のコードと当時のアセットで
 * 再現されること** (要件 3.2 — Phase 3 が「画面から確かめるのは Phase 4」として
 * 積み残した分)、そして **`?rev=` が配信の約束を崩さないこと** — 過去の版を
 * 出すために GitHub を叩き始めたり、限定公開が共有キャッシュに載ったりしない。
 *
 * 作品と 2 世代の写しは playwright.config.ts が D1 と R2 に直に置いている。
 * 種の `revision_checked_at` は今なので、このテストの間 Worker から GitHub へは
 * 出ていかない (偽 GitHub にも履歴の口は無い)。
 */

import { expect, test, type Page } from "@playwright/test";

import { ASSETS_ORIGIN, WEB_ORIGIN } from "./origins";

/** 種として置いてある作品 (e2e/seed.sql)。 */
const AUTHOR = "e2e-author";
const PUBLIC_ID = "E2EPublicSketch0";
const ASSET_ID = "E2EAssetSketch01";
const UNLISTED_ID = "E2EUnlistedSkt01";
/** 写しはあるが台帳を持たない作品 (Cron の埋め直しを見る)。 */
const BACKFILL_ID = "E2EBackfillSkt01";

/** 種のリビジョン (playwright.config.ts と同じ値)。 */
const CURRENT = "e2e1111111111111111111111111111111111111";
const PREV = "e2e0000000000000000000000000000000000000";

/** 版ごとに違う実体を指すアセット (旧 = 緑、今 = 赤)。 */
const BLOB_CURRENT =
  "7c12c1f9323964065d6b659ec1fe67544707644bf1ce287b9b1c195250adfdfe";
const BLOB_PREV =
  "7d7e41d5f4c76f3e3fd8d8c0793726ed5d7d0e40d91207d94a95fd28dd1b5c91";

/** 実行中のスケッチが読めた画像の配信 URL。 */
async function readImageSrc(page: Page): Promise<string | null> {
  for (const frame of page.frames()) {
    if (frame.url() !== "about:srcdoc") continue;
    try {
      const src = await frame.evaluate(() => {
        const written = document.getElementById(
          "written"
        ) as HTMLImageElement | null;
        // 読めていない画像は数えない (naturalWidth が 0 のまま)。
        return written === null || written.naturalWidth === 0
          ? null
          : written.src;
      });
      if (src !== null) return src;
    } catch {
      // 差し替えの途中でフレームが外れた。次の呼び出しで見直す。
    }
  }
  return null;
}

test.describe("リビジョン履歴", () => {
  test("履歴に今の版と旧版が新しい順に並び、今の版に印が付く", async ({
    page,
  }) => {
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    // 今の版の行はクエリの無い正典 URL を指す。
    const current = page.locator(
      `.sketch-history-item a[href="/@${AUTHOR}/${PUBLIC_ID}"]`
    );
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect(current).toContainText(CURRENT.slice(0, 7));
    await expect(current).toContainText("最新");

    // **件数も「先頭が今の版」も当てにしない。** 並びの基準は「p5stage が写しを
    // 持った時刻」(ADR 0016) で、ローカルの R2 は実行をまたいで残るため、以前の種が
    // 置いた写しを埋め直しが後から拾って前に並ぶことがある。順序として確かめられる
    // のは、**同じ作品の中で旧版が今の版より後ろに来る**こと。
    const hrefs = await page
      .locator(".sketch-history-item a")
      .evaluateAll((items) => items.map((item) => item.getAttribute("href")));
    const currentIndex = hrefs.indexOf(`/@${AUTHOR}/${PUBLIC_ID}`);
    const prevIndex = hrefs.indexOf(`/@${AUTHOR}/${PUBLIC_ID}?rev=${PREV}`);

    expect(currentIndex).toBeGreaterThanOrEqual(0);
    expect(prevIndex).toBeGreaterThan(currentIndex);
  });

  test("過去の版を開くと、当時のコードが出る", async ({ page }) => {
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}?rev=${PREV}`);

    // コードは SSR が出しているので、JS を待たずに読める。
    await expect(
      page.locator('.sketch-file[data-file="sketch.js"]')
    ).toContainText("E2E_SKETCH_MARKER_PREV");
    // 過去の版を見ていることが画面に出て、最新へ戻れる。
    await expect(page.locator(".sketch-past")).toContainText("過去の版");
    await expect(page.locator(".sketch-past a")).toHaveAttribute(
      "href",
      new RegExp(`/@${AUTHOR}/${PUBLIC_ID}$`)
    );
    // 版は増え続けるので、検索エンジンには見せない (ADR 0016)。
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/
    );
    // canonical はクエリの無い正典 URL のまま。
    await expect(page.locator("head link[rel=canonical]")).toHaveAttribute(
      "href",
      new RegExp(`/@${AUTHOR}/${PUBLIC_ID}$`)
    );
  });

  test("過去の版は、当時のアセットで再現される", async ({ page }) => {
    // 同じ `cat.png` が版によって別の実体を指す。配信 URL は sha256 なので、
    // **どの実体が配られたか**が URL に出る (ADR 0014)。
    await page.goto(`/@${AUTHOR}/${ASSET_ID}?rev=${PREV}`);

    await expect
      .poll(() => readImageSrc(page), {
        message: "旧版のアセットが読めていません",
        timeout: 15_000,
      })
      .toBe(`${ASSETS_ORIGIN}/a/${BLOB_PREV}/cat.png`);
  });

  test("今の版は、今のアセットで出る", async ({ page }) => {
    // 上の裏返し。過去の版を足したことで今の版がずれていないことを見る。
    await page.goto(`/@${AUTHOR}/${ASSET_ID}`);

    await expect
      .poll(() => readImageSrc(page), {
        message: "今の版のアセットが読めていません",
        timeout: 15_000,
      })
      .toBe(`${ASSETS_ORIGIN}/a/${BLOB_CURRENT}/cat.png`);
  });

  test("今の版を指す ?rev= は正典 URL へ寄せる", async ({ page }) => {
    // 同じ中身に 2 つの URL があると、キャッシュも検索結果も割れる。
    const response = await page.goto(`/@${AUTHOR}/${PUBLIC_ID}?rev=${CURRENT}`);

    expect(new URL(page.url()).search).toBe("");
    expect(response?.status()).toBe(200);
  });

  test("知らない版と形の違う版は 404 で、共有キャッシュに載せない", async ({
    request,
  }) => {
    // 当てずっぽうを安くしない (空振りがエッジに溜まると総当たりが軽くなる)。
    const unknown = await request.get(
      `/@${AUTHOR}/${PUBLIC_ID}?rev=${"a".repeat(40)}`
    );
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()["cache-control"]).toBe("no-store");

    const malformed = await request.get(
      `/@${AUTHOR}/${PUBLIC_ID}?rev=../../secret`
    );
    expect(malformed.status()).toBe(404);
  });

  test("限定公開の過去の版も共有キャッシュに載らない", async ({ request }) => {
    // 「URL を知る人だけ」は、共有キャッシュに載った時点で崩れる (ADR 0011)。
    const response = await request.get(
      `/@${AUTHOR}/${UNLISTED_ID}?rev=${PREV}`,
      { maxRedirects: 0 }
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  });

  test("Cron が、台帳を持たない作品の履歴を写しから埋め直す", async ({
    page,
  }) => {
    // 4-1 より前に書き出された作品には台帳が無い。種の埋め直し用の作品がその状態で
    // (e2e/seed.sql)、R2 には 2 世代の写しだけがある。
    //
    // 埋まる前の状態は見ない。**同じ口 (`/__scheduled`) を他のテストも叩く**ので、
    // 「まだ空であること」を当てにすると並行実行で崩れる。
    //
    // 1 回では終わらないことがある。参照台帳のバックフィル (3-5b) が先に通るまで
    // こちらは走らず (`worker.ts`)、走り始めても R2 は続きから舐めるため、
    // **起こし直しながら待つ**。
    await expect
      .poll(
        async () => {
          const scheduled = await page.request.get(`${WEB_ORIGIN}/__scheduled`);
          expect(scheduled.ok()).toBe(true);
          await page.goto(`/@${AUTHOR}/${BACKFILL_ID}`);
          return page.locator(".sketch-history-item a").count();
        },
        { message: "写しから履歴が起きていません", timeout: 20_000 }
      )
      .toBeGreaterThanOrEqual(2);

    // 埋め直した版はそのまま開ける (台帳に載る版は開けることが前提 — ADR 0016)。
    await page.goto(`/@${AUTHOR}/${BACKFILL_ID}?rev=${PREV}`);
    await expect(
      page.locator('.sketch-file[data-file="sketch.js"]')
    ).toContainText("E2E_SKETCH_MARKER_PREV");
  });

  test("恒久リンクは版の指定を保ったまま正典 URL へ飛ばす", async ({
    request,
  }) => {
    // 落とすと、過去の版へのリンクが黙って最新にすり替わる。
    const response = await request.get(`/s/${PUBLIC_ID}?rev=${PREV}`, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(302);
    expect(response.headers()["location"]).toBe(
      `/@${AUTHOR}/${PUBLIC_ID}?rev=${PREV}`
    );
  });
});
