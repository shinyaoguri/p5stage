/**
 * 設定パネル (1-5) の回帰テスト。
 *
 * 値の検証と CSS 変数の組み立ては settings.test.ts / settings-apply.test.ts が持つ。
 * ここで見るのは適用先が層で分かれていること — CSS でしか触れないものは
 * CSS 変数へ、Monaco が自前で管理するものは Monaco のオプションへ — と、
 * 変更が即座に効いてリロードを跨いで残ること。
 *
 * 加えて、面としての振る舞い (#41 の 4): 右端に貼り付く全高のドロワーであること、
 * 群がアコーディオンであること、閉じる口が届くこと。
 */

import { expect, test } from "@playwright/test";

import {
  accountMenuToggle,
  openEditor,
  openSettings,
  readStoredSettings,
  settingControl,
  settingsDrawer,
} from "./helpers";

/** 行の高さは既定 1.5 なので、文字サイズから行の高さが決まる。 */
const lineHeightFor = (fontSize: number) => `${fontSize * 1.5}px`;

test.describe("エディタ設定", () => {
  test("文字サイズの変更は即座に効き、リロードしても残る", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    await (await settingControl(page, "fontSize")).fill("28");

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

    await (await settingControl(page, "textOpacity")).fill("0.5");

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

  test("括弧の色分けはモデル側で無効になっている", async ({ page }) => {
    await openEditor(page);

    // 括弧の色分けは**エディタではなくモデルのオプション**で決まる (#22)。
    // `monaco.editor.create()` に `bracketPairColorization` を渡しても
    // `getOption` が false を返すだけで装飾は出続けるので、層を取り違えていないか
    // ここで見る。
    const editor = page.locator("#editor");

    // 画面に括弧が出ていることを先に確かめる。出ていなければ下の 0 件は
    // 「色分けされていない」ではなく「見るものが無い」になる。
    await expect(editor.locator(".view-line").first()).toBeVisible();
    expect(await editor.locator(".view-lines").innerText()).toContain("(");

    // 色ではなく装飾の有無で見る (テーマごとに色が変わるため)。クラス名の
    // 出どころは Monaco の colorizedBracketPairsDecorationProvider
    // (`bracket-highlighting-${level % 30}`)。Monaco を上げるときは名前が
    // 変わっていないか確かめる。
    await expect(
      editor.locator('[class*="bracket-highlighting-"]')
    ).toHaveCount(0);
  });

  test("「既定に戻す」で見た目が戻る", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    await (await settingControl(page, "fontSize")).fill("28");
    await expect(page.locator("#editor .view-line").first()).toHaveCSS(
      "font-size",
      "28px"
    );

    await settingsDrawer(page).locator(".settings-panel-reset").click();

    await expect(page.locator("#editor .view-line").first()).toHaveCSS(
      "font-size",
      "14px"
    );
    await expect(await settingControl(page, "fontSize")).toHaveValue("14");
  });

  test("Escape で閉じ、フォーカスは開いたボタンへ戻る", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    await (await settingControl(page, "fontSize")).press("Escape");

    // スケッチの上に重なる面なので、「消して手元を見たい」がすぐ叶うようにする。
    await expect(settingsDrawer(page)).toBeHidden();
    // 開けた項目はアカウントメニューの中で畳まれているので、フォーカスはその
    // 開閉ボタンへ返る (#87 の段階 5 — 押せない項目へは返さない)。
    await expect(accountMenuToggle(page)).toBeFocused();
  });

  test("閉じるボタンでも閉じ、フォーカスは開いたボタンへ戻る", async ({
    page,
  }) => {
    await openEditor(page);
    await openSettings(page);

    // 開いた面の中にも閉じる口が要る。全高のドロワーに隠れて、開けた歯車は遠い
    // (しかもメニューの中なので、開き直すところから始めることになる)。
    await settingsDrawer(page).locator(".settings-panel-close").click();

    await expect(settingsDrawer(page)).toBeHidden();
    // 閉じた面は inert になる。中にフォーカスを取り残さない。
    await expect(accountMenuToggle(page)).toBeFocused();
  });

  test("画面の右端に貼り付く全高の面として開く", async ({ page }) => {
    await openEditor(page);

    // 閉じている間は画面の外。見えないだけでなく、右端を触っても反応しない。
    await expect(settingsDrawer(page)).toBeHidden();

    await openSettings(page);
    // 画面の外から滑り込む面なので、着いてから測る (出てくる途中の位置は
    // 右端からはみ出している)。
    await expect(settingsDrawer(page)).toHaveCSS("transform", "none");

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const box = await settingsDrawer(page).boundingBox();
    expect(box).not.toBeNull();
    if (viewport === null || box === null) return;

    // 歯車の直下に浮くポップオーバーではない。上端から下端まで、右端に貼り付く。
    expect(box.y).toBe(0);
    expect(box.height).toBe(viewport.height);
    expect(Math.round(box.x + box.width)).toBe(viewport.width);
  });

  test("項目の群は畳んであり、見出しを押すと開く", async ({ page }) => {
    await openEditor(page);
    await openSettings(page);

    // 「カーソル」は既定で畳んである群 (開くのはテーマとフォントだけ)。
    const group = settingsDrawer(page).locator(
      ".settings-group:has([data-setting-key='cursorStyle'])"
    );
    const heading = group.locator(".settings-group-toggle");
    await expect(heading).toHaveAttribute("aria-expanded", "false");
    await expect(
      group.locator("[data-setting-key='cursorStyle']")
    ).toBeHidden();

    await heading.click();

    await expect(heading).toHaveAttribute("aria-expanded", "true");
    await expect(
      group.locator("[data-setting-key='cursorStyle']")
    ).toBeVisible();
  });
});
