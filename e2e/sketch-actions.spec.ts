/**
 * 作品ページの、作者にだけ出る操作 (#43)。
 *
 * 確かめるのは 2 つ — **作者には出て編集へ戻れること**と、**それ以外には出ないこと**。
 *
 * 出し分けはクライアントで行う (エッジキャッシュに載る HTML は誰に対しても同じ —
 * ADR 0011)。「まだセッションを引いていない」と「引いた結果、出ない」は見た目が
 * 同じなので、**判定が済んだ印を待ってから**見る。
 */

import { expect, test, type Page } from "@playwright/test";

import { login, openEditor, saveNewSketch } from "./helpers";

/** 種として置いてある他人の作品 (e2e/seed.sql)。ログインする偽利用者とは別人。 */
const FOREIGN_ID = "E2EPublicSketch0";
const FOREIGN_AUTHOR = "e2e-author";

/** セッションを引き終えるまで待つ。 */
async function settled(page: Page): Promise<void> {
  await expect(
    page.locator(".sketch-actions[data-ready='true']")
  ).toBeAttached();
}

function editLink(page: Page) {
  return page.locator("#sketch-edit-link");
}

test.describe("作品ページの作者向け操作", () => {
  test("作者には出て、押すとその作品がエディタで開く", async ({ page }) => {
    await openEditor(page);
    await login(page);
    const id = await saveNewSketch(page, "作者の作品", "public");

    // login に依存しない恒久リンクから入る (正典 URL へ 302 する)。
    await page.goto(`/s/${id}`);
    await settled(page);

    await expect(editLink(page)).toBeVisible();
    await editLink(page).click();
    await page.waitForURL(`**/edit?sketch=${id}`);
  });

  test("ログインしていても他人の作品には出ない", async ({ page }) => {
    await openEditor(page);
    await login(page);

    await page.goto(`/@${FOREIGN_AUTHOR}/${FOREIGN_ID}`);
    await settled(page);

    await expect(editLink(page)).toHaveCount(0);
  });

  test("未ログインでは出ない", async ({ page }) => {
    await page.goto(`/@${FOREIGN_AUTHOR}/${FOREIGN_ID}`);
    await settled(page);

    await expect(editLink(page)).toHaveCount(0);
  });
});
