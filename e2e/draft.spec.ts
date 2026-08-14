/**
 * ドラフト自動保存 (1-6) の回帰テスト。
 *
 * 間引きの時間や書き込みの直列化は draft-store.test.ts が持つ。ここで見るのは
 * 「リロードを跨いで続きから書ける」という、実際のブラウザと IndexedDB が
 * 揃って初めて確かめられる部分。
 */

import { expect, test } from "@playwright/test";

import {
  addFile,
  draftIndicator,
  fileTab,
  fileTabNames,
  openEditor,
  openFile,
  readStoredDraft,
  toasts,
  typeIntoEditor,
} from "./helpers";

test.describe("下書き", () => {
  test("編集はリロードを跨いで続きから始まる", async ({ page }) => {
    await openEditor(page);
    // 開いただけでは書かない (下書きが無い状態で復元の知らせは出ない)。
    await expect(toasts(page)).toHaveCount(0);

    await typeIntoEditor(page, 'console.log("e2e-draft");');
    // 下書きが今どうなっているかは**状態**なので、常時見える場所に残る (#41 の 5)。
    // 出方は文字ではなくドットで、時刻はホバーと `data-saved-at` から読む (#41 の 6)。
    await expect(draftIndicator(page)).toBeVisible();
    await expect(draftIndicator(page)).toHaveAttribute(
      "data-saved-at",
      /^\d+$/
    );

    await page.reload();

    // 黙って復元する。代わりに「いつの続きか」を出す。復元は終わった出来事なので
    // トーストで言う (#41 の 5)。
    await expect(toasts(page, "info")).toContainText("下書きを復元しました");
    await expect(page.locator("#editor")).toContainText("e2e-draft");
  });

  test("ファイル構成と開いていたファイルごと戻る", async ({ page }) => {
    await openEditor(page);

    await addFile(page, "memo.txt");
    await typeIntoEditor(page, "e2e-memo");
    await openFile(page, "style.css");
    await expect(draftIndicator(page)).toBeVisible();

    await page.reload();

    await expect(fileTabNames(page)).toHaveText([
      "index.html",
      "style.css",
      "sketch.js",
      "memo.txt",
    ]);
    await expect(fileTab(page, "style.css")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await openFile(page, "memo.txt");
    await expect(page.locator("#editor")).toContainText("e2e-memo");
  });

  test("「新規」で破棄すると既定のテンプレートに戻る", async ({ page }) => {
    await openEditor(page);
    await typeIntoEditor(page, 'console.log("e2e-draft");');
    await expect(draftIndicator(page)).toBeVisible();

    // 復元は黙ってやるが、破棄は取り消せないので確認を挟む。
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.locator("#new").click();
    await expect(page.locator("#editor")).toContainText("e2e-draft");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("#new").click();

    await expect(toasts(page, "info")).toHaveText(["下書きを破棄しました"]);
    await expect(page.locator("#editor")).toContainText("function setup()");
    // 消した下書きの時刻が出たままにならないこと (#41 の 6)。開き直さなくても、
    // もう復元できるものは無い。
    await expect(draftIndicator(page)).toBeHidden();

    // 消した先から書き戻されないこと (予約中の保存ごと捨てている)。
    await expect.poll(() => readStoredDraft(page)).toBeNull();
    await page.reload();
    // 復元するものが無いので、開き直しても何も知らせは出ない。
    await expect(toasts(page)).toHaveCount(0);
    // 復元できるものが無いので印そのものが出ない。
    await expect(draftIndicator(page)).toBeHidden();
    await expect(page.locator("#editor")).not.toContainText("e2e-draft");
  });
});
