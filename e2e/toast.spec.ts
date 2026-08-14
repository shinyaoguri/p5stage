/**
 * トーストの作法 (#41 の 5)。
 *
 * ここで見るのは**面そのものの振る舞い** — 積み方・消え方・種別。どの操作が
 * どの知らせを出すかは、その操作を持つ spec 側 (draft / files / flow) が見る。
 *
 * 材料にファイル名のエラーを使うのは、**続けて何度も起こせて文言を選べる**ため
 * (`index.html は既にあります` / `. は名前として使えません`)。入力は不正な名前でも
 * 閉じないので (file-tabs.ts)、開いたまま次を打てる。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openEditor, toasts } from "./helpers";

/** 追加の入力を開く。以後は fill + Enter を繰り返せる。 */
async function openAddFileInput(page: Page): Promise<Locator> {
  await page.locator("#file-tabs .file-tab-add").click();
  return page.locator("#file-tabs .file-tab-input");
}

test.describe("トースト", () => {
  test("同じ知らせは積まない", async ({ page }) => {
    await openEditor(page);
    const input = await openAddFileInput(page);

    for (let i = 0; i < 3; i += 1) {
      await input.fill("index.html");
      await input.press("Enter");
      await expect(toasts(page)).toHaveText(["index.html は既にあります"]);
    }
  });

  test("積み上がるのは 3 件まで。溢れたら古い方から消える", async ({
    page,
  }) => {
    await openEditor(page);
    const input = await openAddFileInput(page);

    for (const name of ["index.html", "style.css", "sketch.js"]) {
      await input.fill(name);
      await input.press("Enter");
    }
    await expect(toasts(page)).toHaveText([
      "index.html は既にあります",
      "style.css は既にあります",
      "sketch.js は既にあります",
    ]);

    // 4 件目。一番古いものが押し出される。
    await input.fill(".");
    await input.press("Enter");
    await expect(toasts(page)).toHaveText([
      "style.css は既にあります",
      "sketch.js は既にあります",
      ". は名前として使えません",
    ]);
  });

  test("失敗は error として出る", async ({ page }) => {
    await openEditor(page);
    const input = await openAddFileInput(page);

    await input.fill("index.html");
    await input.press("Enter");

    await expect(toasts(page, "error")).toHaveCount(1);
    // 面そのものは触れない。右上は操作列やスケッチを触る場所でもある。
    await expect(page.locator("#toast-container")).toHaveCSS(
      "pointer-events",
      "none"
    );
  });

  test("知らせは黙って消える", async ({ page }) => {
    await openEditor(page);

    // 破棄の知らせ (info) を出す。4 秒で引き上げる側なので、待ち時間が短い。
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("#new").click();
    await expect(toasts(page, "info")).toHaveText(["下書きを破棄しました"]);

    // 押さなくても消える。消える動き (0.3s) の分まで待つ。
    await expect(toasts(page)).toHaveCount(0, { timeout: 10_000 });
    // 出し入れのたびに増える面ではない (畳んだ後は DOM からも外れる)。
    await expect(page.locator("#toast-container .toast")).toHaveCount(0);
  });
});
