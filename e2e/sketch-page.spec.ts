/**
 * 作品ページ (Phase 2-4)。
 *
 * ここでしか確かめられないのは 3 つ。**閲覧にログインが要らないこと**、
 * **正典 URL に寄せる 302**、そして**閲覧者の画面でも別オリジンの iframe で
 * スケッチが動くこと** (要件 3.4 / 5.1)。
 *
 * 作品は playwright.config.ts が D1 と R2 に直に置いている (作るには GitHub の
 * 認可が要り、E2E では踏めないため)。種の `revision_checked_at` は今なので
 * 再検証の間隔に入らず、**このテストの間 Worker から GitHub へは出ていかない**。
 */

import { expect, test } from "@playwright/test";

import { hasSketchCanvas } from "./helpers";

/** 種として置いてある作品 (e2e/seed.sql)。 */
const PUBLIC_ID = "E2EPublicSketch0";
const UNLISTED_ID = "E2EUnlistedSkt01";
const AUTHOR = "e2e-author";

/** 形は正しいが存在しない ID。 */
const ABSENT_ID = "AAAAAAAAAAAAAAAA";

test.describe("作品ページ", () => {
  test("未ログインで開けて、メタ情報とコードが出る", async ({ page }) => {
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    await expect(page.locator("h1")).toHaveText("E2E 公開スケッチ");
    await expect(page.locator(".sketch-author")).toContainText(AUTHOR);
    // コードは SSR が出しているので、JS を待たずに読める。
    await expect(
      page.locator('.sketch-file[data-file="sketch.js"]')
    ).toContainText("E2E_SKETCH_MARKER");
  });

  test("閲覧者の画面でも別オリジンの iframe でスケッチが動く", async ({
    page,
  }) => {
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    // ランナーは別オリジン (要件 5.1)。中身は srcdoc のスケッチ文書に入る。
    await expect(page.locator("#stage iframe.preview-frame")).toBeAttached();
    await expect
      .poll(() => hasSketchCanvas(page), { timeout: 15_000 })
      .toBe(true);
  });

  test("最初は sketch.js が開いていて、タブで他のファイルへ移れる", async ({
    page,
  }) => {
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    await expect(
      page.locator('.sketch-file[data-file="sketch.js"]')
    ).toBeVisible();
    await expect(
      page.locator('.sketch-file[data-file="notes.txt"]')
    ).toBeHidden();

    await page.locator('.sketch-tab[data-file="notes.txt"]').click();

    await expect(
      page.locator('.sketch-file[data-file="notes.txt"]')
    ).toBeVisible();
    await expect(
      page.locator('.sketch-file[data-file="sketch.js"]')
    ).toBeHidden();
  });

  test("login が違えば正典 URL へ 302 する", async ({ page }) => {
    // 作者が GitHub で改名しても古いリンクが生きる形。Gist は同じ形の URL が
    // 改名で 404 になるので、その穴をこちらで塞いでいる (ADR 0011)。
    const response = await page.goto(`/@oldname/${PUBLIC_ID}`);

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/@${AUTHOR}/${PUBLIC_ID}`);
  });

  test("恒久リンク /s/:id も正典 URL へ 302 する", async ({ page }) => {
    await page.goto(`/s/${PUBLIC_ID}`);

    expect(new URL(page.url()).pathname).toBe(`/@${AUTHOR}/${PUBLIC_ID}`);
  });

  test("正典 URL を canonical として申告する", async ({ page }) => {
    // /s/:id からも来られるので、検索エンジンには 1 つを正として伝える。
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/@${AUTHOR}/${PUBLIC_ID}$`)
    );
  });

  test("公開作品はエッジに載せる", async ({ page }) => {
    const response = await page.request.get(`/@${AUTHOR}/${PUBLIC_ID}`);

    expect(response.headers()["cache-control"]).toContain("s-maxage");
  });

  test("限定公開は共有キャッシュに載せず、検索エンジンにも載せない", async ({
    page,
  }) => {
    // 「URL を知る人だけ」という約束は、共有キャッシュや検索結果に出た時点で崩れる。
    const response = await page.goto(`/@${AUTHOR}/${UNLISTED_ID}`);

    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/
    );
  });

  test("限定公開には private ではない旨の注意書きを出す", async ({ page }) => {
    await page.goto(`/@${AUTHOR}/${UNLISTED_ID}`);

    await expect(page.locator(".sketch-warning")).toContainText(
      "URL を知っている人は誰でも"
    );
  });

  test("存在しない作品は 404 (他人のものでも同じ応答)", async ({ page }) => {
    const response = await page.request.get(`/@${AUTHOR}/${ABSENT_ID}`);

    expect(response.status()).toBe(404);
  });

  test("形の違う ID は 404 (D1 まで持って行かない)", async ({ page }) => {
    for (const id of ["short", "x".repeat(64)]) {
      const response = await page.request.get(
        `/@${AUTHOR}/${encodeURIComponent(id)}`
      );
      expect(response.status()).toBe(404);
    }
  });

  test("恒久リンクも存在しなければ 404", async ({ page }) => {
    const response = await page.request.get(`/s/${ABSENT_ID}`, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(404);
  });
});
