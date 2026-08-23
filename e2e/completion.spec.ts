/**
 * p5.js の補完 (Issue #104 の段階 1 / ADR 0021)。
 *
 * 型定義を渡せているかは**実ブラウザでしか確かめられない**。Monaco の言語サービスは
 * ワーカーの中で動き、`addExtraLib` に渡した d.ts を TypeScript 自身が辿って
 * 初めて候補が出る。前処理そのもの (JSDoc の落とし方・URL の組み立て) は
 * apps/web/test/p5-types.test.ts が見る。
 *
 * 補完は**エディタの初期表示より後に効き始める** (型定義は動的 import で遅れて届く)
 * ので、候補が出るまで待つ形で書く。
 */

import { expect, test, type Page } from "@playwright/test";

import { addFile, openEditor, openFile, typeIntoEditor } from "./helpers";

/** 補完リスト。Monaco は表示中だけ `.visible` を付ける。 */
const suggestions = (page: Page) =>
  page.locator(".suggest-widget.visible .monaco-list-row");

/** いま選ばれている候補。絞り込みの結果はここに出る。 */
const focusedSuggestion = (page: Page) =>
  page.locator(".suggest-widget.visible .monaco-list-row.focused");

/** 引数のヒント (シグネチャヘルプ)。 */
const parameterHints = (page: Page) =>
  page.locator(".parameter-hints-widget.visible");

test.describe("p5.js の補完", () => {
  test("グローバル API が候補に出る", async ({ page }) => {
    await openEditor(page);
    await typeIntoEditor(page, "createCan");

    await expect(focusedSuggestion(page)).toContainText("createCanvas");
  });

  test("引数のヒントに p5 のシグネチャが出る", async ({ page }) => {
    await openEditor(page);
    // 候補が出るところまで待ってから打つ。型定義が届く前だと引数のヒントも出ない。
    await typeIntoEditor(page, "fil");
    await expect(focusedSuggestion(page)).toContainText("fill");

    await page.keyboard.press("Escape");
    await page.keyboard.type("l(");

    await expect(parameterHints(page)).toContainText("v1: number");
  });

  test("戻り値のメソッドまで辿れる", async ({ page }) => {
    // `p5.Vector` は global.d.ts ではなく src/**/*.d.ts 側にある。ここが出るかが
    // 「パッケージ一式を渡せているか」の判定になる (global.d.ts だけでは出ない)。
    await openEditor(page);
    await typeIntoEditor(page, "createVec");
    await expect(focusedSuggestion(page)).toContainText("createVector");

    await page.keyboard.press("Escape");
    await page.keyboard.type("tor().mul");

    await expect(focusedSuggestion(page)).toContainText("mult");
  });

  test("別のファイルに書いた関数も候補に出る", async ({ page }) => {
    // `import`/`export` を含まない JS はグローバルスクリプト扱いになるので、
    // 利用者が自分で書いた関数もファイルを跨いで候補に出る。**Monaco 0.56 では
    // 何も設定せずにこうなる** (`setEagerModelSync` は真偽どちらでも同じだった)
    // ので、これは今の振る舞いを固定する回帰テスト。ワーカーへ送るモデルを
    // 絞る変更 (#18) を入れたときに、ここが落ちて気付ける。
    await openEditor(page);
    await addFile(page, "other.js");
    await typeIntoEditor(page, "function helperFromOtherFile() {}");

    await openFile(page, "sketch.js");
    await typeIntoEditor(page, "helperFromOther");

    await expect(focusedSuggestion(page)).toContainText("helperFromOtherFile");
  });

  test("既定のテンプレートに赤線が出ない", async ({ page }) => {
    // 意味解析は止めたままにしてある (段階 2 で戻す)。**戻すときの回帰の土台**として
    // 「既定テンプレートが赤線ゼロ」をここに置く。ここが崩れると全利用者に出る。
    await openEditor(page);

    // 型定義が届いた状態で数えたいが、`sketch.js` は既定のまま残す必要がある。
    // 別ファイルで候補が出るのを待ってから戻る。
    await addFile(page, "probe.js");
    await typeIntoEditor(page, "createCan");
    await expect(suggestions(page).first()).toBeVisible();
    await page.keyboard.press("Escape");

    await openFile(page, "sketch.js");

    await expect(page.locator("#editor .view-lines")).toContainText(
      "createCanvas(windowWidth, windowHeight)"
    );
    await expect(page.locator("#editor .squiggly-error")).toHaveCount(0);
  });
});
