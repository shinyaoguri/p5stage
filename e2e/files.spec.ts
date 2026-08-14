/**
 * ファイルタブ (1-3) の回帰テスト。
 *
 * 判定そのものは file-actions.ts の単体テストが持つ。ここで見るのは
 * 「タブの上でそのまま名前を入力させる」という UI の組み立てと、
 * ファイルごとに undo 履歴が分かれていること (Monaco のモデル分割) の 2 つ。
 */

import { expect, test } from "@playwright/test";

import {
  addFile,
  editorModifier,
  fileTab,
  fileTabNames,
  openEditor,
  openFile,
  toasts,
  typeIntoEditor,
} from "./helpers";

test.describe("ファイルタブ", () => {
  test("既定の 3 ファイルが並び、sketch.js が開いている", async ({ page }) => {
    await openEditor(page);

    await expect(fileTabNames(page)).toHaveText([
      "index.html",
      "style.css",
      "sketch.js",
    ]);
    await expect(fileTab(page, "sketch.js")).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("ファイルを追加すると、そのファイルが開く", async ({ page }) => {
    await openEditor(page);

    await addFile(page, "memo.txt");

    await expect(fileTabNames(page)).toHaveText([
      "index.html",
      "style.css",
      "sketch.js",
      "memo.txt",
    ]);
    await expect(fileTab(page, "sketch.js")).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  test("使えない名前は理由が出て、入力はそのまま直せる", async ({ page }) => {
    await openEditor(page);

    await page.locator("#file-tabs .file-tab-add").click();
    const input = page.locator("#file-tabs .file-tab-input");
    await input.fill("dir/file.js");
    await input.press("Enter");

    // 断る理由はトーストで出す (#41 の 5)。実行の状態に出していた頃は、次の実行が
    // 来た瞬間に消えていた。
    await expect(toasts(page, "error")).toContainText("フォルダは作れません");
    // 打ち直せるよう入力は残す (閉じてしまうと名前を一から入れ直しになる)。
    await expect(input).toBeVisible();

    await input.fill("ok.js");
    await input.press("Enter");
    await expect(fileTab(page, "ok.js")).toBeVisible();
  });

  test("F2 で名前を変えられる", async ({ page }) => {
    await openEditor(page);

    await fileTab(page, "sketch.js").press("F2");
    const input = page.locator("#file-tabs .file-tab-input");
    await input.fill("main.js");
    await input.press("Enter");

    await expect(fileTabNames(page)).toHaveText([
      "index.html",
      "style.css",
      "main.js",
    ]);
    await expect(fileTab(page, "main.js")).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("index.html は実行の起点なので消せない", async ({ page }) => {
    await openEditor(page);

    // 消せないものに × を出さない (押せる見た目にしてから断らない)。
    await expect(
      fileTab(page, "index.html").locator(".file-tab-remove")
    ).toHaveCount(0);

    await fileTab(page, "index.html").press("Delete");

    await expect(toasts(page, "error")).toContainText(
      "index.html は実行の起点なので削除できません"
    );
    await expect(fileTab(page, "index.html")).toBeVisible();
  });

  test("中身のあるファイルの削除は確認を挟む", async ({ page }) => {
    await openEditor(page);
    await addFile(page, "memo.txt");
    await typeIntoEditor(page, "e2e-memo");

    // 取り消せない操作なので、まず断ったときに残ることを見る。
    page.once("dialog", (dialog) => void dialog.dismiss());
    await fileTab(page, "memo.txt").locator(".file-tab-remove").click();
    await expect(fileTab(page, "memo.txt")).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await fileTab(page, "memo.txt").locator(".file-tab-remove").click();
    await expect(fileTab(page, "memo.txt")).toHaveCount(0);
  });

  test("undo 履歴はファイルごとに分かれている", async ({ page }) => {
    await openEditor(page);

    // 移植元は単一モデルの setValue 切替だったため、タブを移ると別ファイルの
    // 編集が undo で戻ってしまう。モデルを分けた効果をここで固定する。
    await typeIntoEditor(page, "e2e-sketch");
    await addFile(page, "memo.txt");
    await typeIntoEditor(page, "e2e-memo");

    await openFile(page, "sketch.js");
    await page.locator("#editor .view-lines").click();
    // Monaco が編集をどこで区切るかは打鍵の間合いで変わるので、
    // 戻せなくなるまで戻す (最初の内容より前には戻らない)。
    const modifier = await editorModifier(page);
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press(`${modifier}+z`);
    }

    // sketch.js は既定のテンプレートまで戻る。
    await expect(page.locator("#editor")).not.toContainText("e2e-sketch");
    await expect(page.locator("#editor")).toContainText("function setup()");
    // memo.txt には波及しない。
    await openFile(page, "memo.txt");
    await expect(page.locator("#editor")).toContainText("e2e-memo");
  });
});
