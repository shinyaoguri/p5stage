/**
 * 取り込みと切り離しの導線 (Phase 2-6)。
 *
 * 取り込みそのものは GitHub の認可が要るので E2E では踏めない。ここで見るのは
 * **ログイン前でも踏める導線**に限る — ダイアログが開くか、入力の不備をその場で
 * 返すか、そして**正本が無い作品で「Gist を外す」を出していないか**。
 * 出したままにすると、押せない操作が押せるように見える。
 */

import { expect, test } from "@playwright/test";

import { openEditor } from "./helpers";

test.describe("Gist の取り込み", () => {
  test("ダイアログを開いて閉じられる", async ({ page }) => {
    await openEditor(page);

    await page.locator("#adopt").click();
    await expect(page.locator("#adopt-dialog")).toBeVisible();

    await page.locator("#adopt-dialog button", { hasText: "やめる" }).click();
    await expect(page.locator("#adopt-dialog")).toBeHidden();
  });

  test("空のまま取り込もうとするとその場で断る", async ({ page }) => {
    await openEditor(page);
    await page.locator("#adopt").click();

    await page.locator("#adopt-confirm").click();

    // サーバまで行かずに返す。閉じないので貼り直しからやり直さずに済む。
    await expect(page.locator("#adopt-error")).toHaveText(/URL または ID/);
    await expect(page.locator("#adopt-dialog")).toBeVisible();
  });

  test("ログインしていなければ取り込みはログインを促す", async ({ page }) => {
    await openEditor(page);
    await page.locator("#adopt").click();

    await page.locator("#adopt-ref").fill("0123456789abcdef0123456789abcdef");
    await page.locator("#adopt-confirm").click();

    await expect(page.locator("#adopt-error")).toHaveText(/ログイン/);
  });
});

test.describe("Gist の切り離し", () => {
  test("正本の無い作品では操作を出さない", async ({ page }) => {
    await openEditor(page);

    // まだ一度も保存していない = 外す相手がいない。
    await expect(page.locator("#detach")).toBeHidden();
  });
});
