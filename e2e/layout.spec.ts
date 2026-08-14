/**
 * エディタ画面の骨格 (#41 の段階 1) の回帰テスト。
 *
 * 見るのは「余白を 1 か所が決めている」こと。値そのものより、**エディタと
 * ファイルタブが同じ縦線に載り、トークンを動かすと一緒に動く**という関係が要る。
 * 各所が自前の値を持っていた頃 (エディタ 32px / タブ 12px) の姿に戻ったら赤くなる。
 *
 * CSS は実ブラウザでしか確かめられない (vitest は DOM を持たない) のでここに置く。
 */

import { expect, test, type Page } from "@playwright/test";

import { openEditor, openSettings, settingControl } from "./helpers";

/** `--editor-padding` の実効値 (px)。 */
function editorPadding(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--editor-padding"
      )
    )
  );
}

/** 要素の左端 (ビューポート基準の px)。 */
async function leftEdge(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} が画面に出ていません`);
  return box.x;
}

test.describe("エディタ画面の余白", () => {
  test("エディタとファイルタブは同じ余白から左端を決める", async ({ page }) => {
    await openEditor(page);

    const padding = await editorPadding(page);
    // 既定幅では下限 (0.5rem) より広い側が採られる。
    expect(padding).toBeGreaterThan(8);

    expect(await leftEdge(page, "#editor")).toBe(padding);
    expect(await leftEdge(page, "#file-tabs")).toBe(padding);
  });

  test("狭い画面では余白が詰まり、両方が一緒に動く", async ({ page }) => {
    await openEditor(page);
    const wide = await editorPadding(page);

    // 段階 1 の時点で操作系の配置は変えない。動くのは余白だけ。
    await page.setViewportSize({ width: 600, height: 800 });
    await expect.poll(() => editorPadding(page)).toBeLessThan(wide);

    const narrow = await editorPadding(page);
    expect(await leftEdge(page, "#editor")).toBe(narrow);
    expect(await leftEdge(page, "#file-tabs")).toBe(narrow);
  });
});

test.describe("モーション低減", () => {
  /**
   * 一括停止は `*` に当ててあるので、自前の CSS だけでなく Monaco が持ち込む
   * 規則にも効く。**それを踏める動きが今はカーソルの点滅しか無い**ので、
   * ここを代表として見る (段階 2 以降で足す動きは同じ規則の下に入る)。
   */
  test("止める規則は Monaco が持ち込むアニメーションにも届く", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page);
    await openSettings(page);
    await (await settingControl(page, "cursorBlinking")).selectOption("smooth");

    // 点滅はフォーカスがある間だけ。外れている間は Monaco が `cursor-solid` に
    // 落とすので、当てる先の規則がそもそも付かない。
    await page.locator("#editor .view-lines").click();

    const layer = page.locator("#editor .cursors-layer").first();
    await expect(layer).toHaveCSS("animation-name", "monaco-cursor-smooth");
    await expect
      .poll(() =>
        layer.evaluate((el) =>
          Number.parseFloat(getComputedStyle(el).animationDuration)
        )
      )
      .toBeLessThan(0.01);

    // 止めた結果としてカーソルが消えていないこと。`animation-fill-mode` が
    // `none` なので最終キーフレーム (opacity 0) には留まらない。
    await expect(layer).toHaveCSS("opacity", "1");
  });
});
