/**
 * ユーザーページ (Phase 5)。作者の公開作品を並べる。
 *
 * ここで確かめるのは**作品から作者へ辿れること** (これまで作品ページの作者リンクは
 * ページの無い URL を指していた) と、一覧の選定・正典 URL への 302。
 *
 * 見るのは種の作者 (`e2e-author`) の方。ログインする利用者 (`e2e-user` —
 * e2e/fake-github/viewer.ts) は別人で、並行する spec が保存やフォークで作品を
 * 増やすので、そちらのページは件数が実行ごとに変わる。
 */

import { expect, test } from "@playwright/test";

/** 種として置いてある作者と作品 (e2e/seed.sql)。 */
const AUTHOR = "e2e-author";
const PUBLIC_TITLE = "E2E 公開スケッチ";
const PUBLIC_ID = "E2EPublicSketch0";

/** 形は正しいが p5stage を使っていない login。 */
const ABSENT_LOGIN = "e2e-nobody";

test.describe("ユーザーページ", () => {
  test("未ログインで作者の公開作品が並び、カードから作品ページへ行ける", async ({
    page,
  }) => {
    await page.goto(`/@${AUTHOR}`);

    await expect(page.locator("h1")).toHaveText(AUTHOR);

    const card = page.getByRole("link", { name: PUBLIC_TITLE });
    await expect(card).toBeVisible();

    await card.click();

    await expect(page).toHaveURL(`/@${AUTHOR}/${PUBLIC_ID}`);
    await expect(page.locator("h1")).toHaveText(PUBLIC_TITLE);
  });

  test("作品ページの作者リンクから辿り着ける", async ({ page }) => {
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    await page.locator(".sketch-author").click();

    await expect(page).toHaveURL(`/@${AUTHOR}`);
    await expect(page.locator("h1")).toHaveText(AUTHOR);
  });

  test("限定公開・未保存・削除済みの作品は並ばない", async ({ page }) => {
    await page.goto(`/@${AUTHOR}`);

    // 一覧が空だから無い、と区別する。公開の種が出た上で他が無いことを見る。
    await expect(page.getByText(PUBLIC_TITLE)).toBeVisible();

    await expect(page.getByText("E2E 限定公開スケッチ")).toHaveCount(0);
    await expect(page.getByText("E2E 未保存スケッチ")).toHaveCount(0);
    await expect(page.getByText("E2E 削除済みスケッチ")).toHaveCount(0);
  });

  test("大文字小文字の違う URL は正典へ 302", async ({ page }) => {
    // GitHub の login は大小を区別しない。同じ人に複数の URL を持たせない。
    const response = await page.goto("/@E2E-Author");

    await expect(page).toHaveURL(`/@${AUTHOR}`);
    // 302 を挟んだ上で、行き着いた先が本人のページであること。
    expect(response?.request().redirectedFrom()).not.toBeNull();
    await expect(page.locator("h1")).toHaveText(AUTHOR);
  });

  test("p5stage を使っていない login は 404", async ({ page }) => {
    const response = await page.goto(`/@${ABSENT_LOGIN}`);

    expect(response?.status()).toBe(404);
    // 後でその人がログインすれば居るようになるので、共有キャッシュには載せない。
    expect(response?.headers()["cache-control"]).toBe("no-store");
  });

  test("login の形をしていない値も 404 (D1 まで持って行かない)", async ({
    page,
  }) => {
    const response = await page.goto("/@" + "a".repeat(40));

    expect(response?.status()).toBe(404);
  });
});
