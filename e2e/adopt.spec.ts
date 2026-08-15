/**
 * 取り込みと切り離しの導線 (Phase 2-6)。
 *
 * ここで見るのは**ログイン前でも踏める導線**に限る — ダイアログが開くか、入力の
 * 不備をその場で返すか、そして**正本が無い作品で「Gist を外す」を出していないか**。
 * 出したままにすると、押せない操作が押せるように見える。
 *
 * 取り込みと切り離しが成立するところまでは `flow.spec.ts` が踏む (Phase 2-7)。
 */

import { expect, test } from "@playwright/test";

import { openAdopt, openEditor, openWorkMenu } from "./helpers";

test.describe("Gist の取り込み", () => {
  test("ダイアログを開いて閉じられる", async ({ page }) => {
    await openEditor(page);

    await openAdopt(page);
    await expect(page.locator("#adopt-dialog")).toBeVisible();

    await page.locator("#adopt-dialog button", { hasText: "やめる" }).click();
    await expect(page.locator("#adopt-dialog")).toBeHidden();
  });

  test("空のまま取り込もうとするとその場で断る", async ({ page }) => {
    await openEditor(page);
    await openAdopt(page);

    await page.locator("#adopt-confirm").click();

    // サーバまで行かずに返す。閉じないので貼り直しからやり直さずに済む。
    await expect(page.locator("#adopt-error")).toHaveText(/URL または ID/);
    await expect(page.locator("#adopt-dialog")).toBeVisible();
  });

  test("ログインしていなければ取り込みはログインを促す", async ({ page }) => {
    await openEditor(page);
    await openAdopt(page);

    await page.locator("#adopt-ref").fill("0123456789abcdef0123456789abcdef");
    await page.locator("#adopt-confirm").click();

    await expect(page.locator("#adopt-error")).toHaveText(/ログイン/);
  });
});

test.describe("Gist の切り離し", () => {
  test("正本の無い作品では操作を出さない", async ({ page }) => {
    await openEditor(page);
    await openWorkMenu(page);

    // まだ一度も保存していない = 外す相手がいない。作品メニューを開いても、
    // 押せない操作が並んでいることは無い。
    await expect(page.locator("#detach")).toBeHidden();
  });
});
