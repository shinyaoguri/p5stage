/**
 * 設定パネル (1-5) の回帰テスト。
 *
 * 値の検証と CSS 変数の組み立ては settings.test.ts / settings-apply.test.ts が持つ。
 * ここで見るのは適用先が層で分かれていること — CSS でしか触れないものは
 * CSS 変数へ、Monaco が自前で管理するものは Monaco のオプションへ — と、
 * 変更が即座に効いてリロードを跨いで残ること。
 */

import { expect, test } from "@playwright/test";

import {
  openEditor,
  openSettings,
  readStoredSettings,
  settingControl,
} from "./helpers";

/** 行の高さは既定 1.5 なので、文字サイズから行の高さが決まる。 */
const lineHeightFor = (fontSize: number) => `${fontSize * 1.5}px`;

test.describe("エディタ設定", () => {
  test("文字サイズの変更は即座に効き、リロードしても残る", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    await settingControl(page, "fontSize").fill("28");

    // 書体まわりは Monaco が自前で持つので、CSS 変数ではなく実際の行に出る。
    const line = page.locator("#editor .view-line").first();
    await expect(line).toHaveCSS("font-size", "28px");
    await expect(line).toHaveCSS("line-height", lineHeightFor(28));

    // 書き込みは間引かれるので、着地を待ってからリロードする。ページを離れる
    // ときの書き切り (pagehide) は間に合わないことがあり、待たずに再読み込みすると
    // 「保存されなかった」のか「復元されなかった」のか切り分けられない。
    await expect
      .poll(async () => {
        const stored = (await readStoredSettings(page)) as {
          fontSize?: number;
        } | null;
        return stored?.fontSize ?? null;
      })
      .toBe(28);

    await page.reload();
    await expect(page.locator("#editor .view-line").first()).toHaveCSS(
      "font-size",
      "28px"
    );
  });

  test("透明度は CSS 変数として当たる", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    await settingControl(page, "textOpacity").fill("0.5");

    // CSS でしか触れない層。Monaco のオプションと二重に指定しない。
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            "--editor-text-opacity"
          )
        )
      )
      .toBe("0.5");
  });

  test("「既定に戻す」で見た目が戻る", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    await settingControl(page, "fontSize").fill("28");
    await expect(page.locator("#editor .view-line").first()).toHaveCSS(
      "font-size",
      "28px"
    );

    await page.locator("#settings .settings-panel-reset").click();

    await expect(page.locator("#editor .view-line").first()).toHaveCSS(
      "font-size",
      "14px"
    );
    await expect(settingControl(page, "fontSize")).toHaveValue("14");
  });

  test("Escape で閉じ、フォーカスは開いたボタンへ戻る", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    await settingControl(page, "fontSize").press("Escape");

    // スケッチの上に重なる面なので、「消して手元を見たい」がすぐ叶うようにする。
    await expect(page.locator("#settings .settings-panel-body")).toBeHidden();
    await expect(
      page.locator("#settings .settings-panel-toggle")
    ).toBeFocused();
  });
});
