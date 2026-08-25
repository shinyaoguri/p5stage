/**
 * エディタの説明文 (ホバー) の描画とサニタイズ (Issue #111 / ADR 0024)。
 *
 * ここは **Monaco の DOMPurify を npm 版へ差し替えた**ことの受け皿。差し替えで
 * 壊れるとしたらサニタイザを通る描画経路なので、実ブラウザで 2 つを見る。
 *
 * - p5 の説明文がホバーに出ること (marked → DOMPurify の経路が生きている)
 * - 他人のスケッチ由来の JSDoc に HTML を仕込んでも、描画されず走りもしないこと
 *
 * 2 つ目は**この差し替えが守ろうとしている脅威モデルそのもの**。p5stage は
 * 他者の書いたコードをエディタで開くので、説明文の材料は攻撃者の入力になりうる。
 * 実際には marked 側の `renderer.html` が先に落とすが、その後段に DOMPurify が
 * 控える形は変えていないことを、外から見える振る舞いで固定しておく。
 *
 * 差し替えの前提 (同梱版を読む口が 1 つだけ・版が逆転していない) は
 * apps/web/test/monaco-dompurify.test.ts が見る。
 */

import { expect, test, type Page } from "@playwright/test";

import { openEditor, typeIntoEditor } from "./helpers";

/**
 * ホバーの吹き出し。
 *
 * `.monaco-hover` は行番号側 (グリフ) にも常駐していて、隠れている間は
 * `.hidden` が付く。中身のホバーだけを掴む。
 */
const hover = (page: Page) => page.locator(".monaco-hover:not(.hidden)");

/**
 * 識別子にホバーして吹き出しを出す。
 *
 * 型定義は動的 import で遅れて届くので、出るまで待つ形で書く
 * (e2e/completion.spec.ts と同じ事情)。
 */
async function hoverIdentifier(page: Page, name: string): Promise<void> {
  await expect(async () => {
    await page
      .locator("#editor .view-lines")
      .getByText(name, { exact: true })
      .last()
      .hover();
    await expect(hover(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
}

test.describe("エディタの説明文", () => {
  test("p5 の説明文がホバーに出る", async ({ page }) => {
    await openEditor(page);
    await typeIntoEditor(page, "createCanvas");
    await hoverIdentifier(page, "createCanvas");

    // 署名と、@types/p5 の JSDoc から来る説明文。marked が組み立てて
    // DOMPurify を通った HTML がここに出ている。
    await expect(hover(page)).toContainText("createCanvas");
    await expect(hover(page)).toContainText("canvas");
  });

  test("JSDoc に仕込んだ HTML は描画されず走りもしない", async ({ page }) => {
    await openEditor(page);
    // 1 行で書ける形に留める (改行を挟むと自動インデントでずれる)。
    await typeIntoEditor(
      page,
      '/** danger <img src=x onerror="window.__xss = true"> ' +
        "[link](javascript:window.__xss = true) */ function probe() {} probe"
    );
    await hoverIdentifier(page, "probe");

    // 説明文自体は出る (JSDoc が読まれている証拠)。
    await expect(hover(page)).toContainText("danger");
    // 仕込んだタグは要素として残らない。
    await expect(hover(page).locator("img")).toHaveCount(0);
    // `javascript:` のリンクも辿れる形では残らない。
    for (const href of await hover(page)
      .locator("a")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href") ?? "")
      )) {
      expect(href.toLowerCase()).not.toContain("javascript:");
    }
    // ハンドラが走っていない。
    expect(
      await page.evaluate(
        () => (window as unknown as { __xss?: boolean }).__xss ?? false
      )
    ).toBe(false);
  });
});
