/**
 * 「書いたものが別オリジンで実行される」ことの回帰テスト (Phase 1 の完了条件)。
 *
 * 本体 → ランナー → スケッチと 2 段の iframe を跨ぐ経路なので、途中のどこが
 * 切れても単体テストでは分からない。ここでは往復のハンドシェイク・コンソール
 * ブリッジ・マルチファイルの実行時解決を、実際に動かして確かめる。
 */

import { expect, test } from "@playwright/test";

import {
  addFile,
  consoleLines,
  consolePanel,
  expectGeneration,
  hasSketchCanvas,
  openEditor,
  openFile,
  runButton,
  typeIntoEditor,
} from "./helpers";

test.describe("スケッチの実行", () => {
  test("既定のテンプレートは開いただけで描画まで通る", async ({ page }) => {
    // openEditor が待つ「実行 #1」は ready → run → rendered の往復が
    // 通ったことを意味する。
    await openEditor(page);

    // 描画まで通ったこと。p5.js は既定テンプレートが CDN から読む。
    await expect
      .poll(() => hasSketchCanvas(page), {
        message: "スケッチが canvas を描いていません",
      })
      .toBe(true);
  });

  test("編集して ⌘/Ctrl+Enter で実行すると、その内容が動く", async ({
    page,
  }) => {
    await openEditor(page);

    await typeIntoEditor(page, 'console.log("e2e:" + (2 * 21));');
    await page.keyboard.press("ControlOrMeta+Enter");

    await expectGeneration(page, 2);
    // 計算した結果が返るので、コードが実際に実行されている
    // (文字列がそのまま素通ししているのではない)。
    await expect(consolePanel(page)).toContainText("e2e:42");
  });

  test("スケッチの未捕捉エラーはエラーとしてコンソールに出る", async ({
    page,
  }) => {
    await openEditor(page);

    await typeIntoEditor(page, 'throw new Error("e2e-boom");');
    await page.keyboard.press("ControlOrMeta+Enter");

    await expectGeneration(page, 2);
    await expect(consolePanel(page)).toContainText("e2e-boom");
    await expect(consoleLines(page).first()).toHaveClass(/console-error/);
    // 畳んでいても気付けるよう、件数の脇にエラー数が出る。
    await expect(page.locator("#console .console-panel-count")).toContainText(
      "エラー"
    );
  });

  test("追加したファイルを実行中のスケッチから読める", async ({ page }) => {
    await openEditor(page);

    // 相対名のまま書いたスケッチが、ランナーの作る blob URL へ振り替わるか
    // (ADR 0007 の実行時参照)。マルチファイルの実行はここが要。
    await addFile(page, "data.txt");
    await typeIntoEditor(page, "e2e-file-body");

    await openFile(page, "sketch.js");
    await typeIntoEditor(
      page,
      'fetch("data.txt").then((r) => r.text()).then((t) => console.log("read:" + t));'
    );
    await page.keyboard.press("ControlOrMeta+Enter");

    await expectGeneration(page, 2);
    await expect(consolePanel(page)).toContainText("read:e2e-file-body");
  });

  test("停止するとスケッチが画面から消える", async ({ page }) => {
    await openEditor(page);
    await expect.poll(() => hasSketchCanvas(page)).toBe(true);

    await runButton(page).click();

    // 止まったことは文字ではなくボタン自身が示す (#41 の 6)。
    await expect(runButton(page)).toHaveAttribute("data-running", "false");
    // 止めるとは文書ごと捨てること (タイマー・音・カメラを手放す)。
    await expect
      .poll(() => hasSketchCanvas(page), {
        message: "停止したのにスケッチが残っています",
      })
      .toBe(false);
  });

  test("実行してから編集すると、実行ボタンが再実行の口になる", async ({
    page,
  }) => {
    await openEditor(page);
    // 動いていて、画面が今のコードのまま = 押したら止まる。
    await expect(runButton(page)).toHaveAttribute("data-running", "true");
    await expect(runButton(page)).toHaveAttribute("aria-label", "停止");

    await typeIntoEditor(page, 'console.log("e2e-restale");');

    // 書き換えた時点で、画面のスケッチは今の中身ではなくなる。ここで押して
    // 止まってしまうと、最も多い操作 (再実行) がマウスから届かない (#41 の 6)。
    await expect(runButton(page)).toHaveAttribute("aria-label", /^再実行/);
    await runButton(page).click();

    await expectGeneration(page, 2);
    await expect(consolePanel(page)).toContainText("e2e-restale");
    // 実行したので古くなくなった = また止められる。
    await expect(runButton(page)).toHaveAttribute("aria-label", "停止");
    await expect
      .poll(() => hasSketchCanvas(page), {
        message: "再実行したのにスケッチが出ていません",
      })
      .toBe(true);
  });

  test("実行のたびにコンソールは前回の出力を持ち越さない", async ({ page }) => {
    await openEditor(page);

    await typeIntoEditor(page, 'console.log("e2e-first");');
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(consolePanel(page)).toContainText("e2e-first");

    await typeIntoEditor(page, 'console.log("e2e-second");');
    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(consolePanel(page)).toContainText("e2e-second");
    await expect(consolePanel(page)).not.toContainText("e2e-first");
  });
});
