/**
 * 操作列のアイコンボタン (#41 の 2) の回帰テスト。
 *
 * **アイコンだけのボタンは、名前を付け忘れても見た目には出ない。** 押せば動くので
 * 手で触っても気付けず、気付くのは支援技術で使う人だけになる。組み立てを
 * `makeToolbarButton()` に寄せた意味がここにあるので、名前が付いていることを
 * 実物の DOM で見る。
 */

import { expect, test, type Page } from "@playwright/test";

import { login, openEditor, openSettings } from "./helpers";

/** 操作列に出ているアイコンボタン。 */
function toolbarButtons(page: Page) {
  return page.locator(".chrome .toolbar-btn:visible");
}

test.describe("操作列", () => {
  test("アイコンボタンはすべて名前を持つ", async ({ page }) => {
    await openEditor(page);

    const buttons = toolbarButtons(page);
    // 未ログインで出るのは 保存 / 新規 / Gist から開く / 設定 / ログイン。
    await expect(buttons).toHaveCount(5);

    for (const button of await buttons.all()) {
      const label = await button.getAttribute("aria-label");
      expect(label ?? "").not.toBe("");
      // ホバーで読める説明も要る (マウスだけの人はここしか手掛かりが無い)。
      expect(await button.getAttribute("title")).toBe(label);
      // 絵そのものは読み上げから外す (名前は aria-label が持つ)。
      await expect(button.locator("svg")).toHaveAttribute(
        "aria-hidden",
        "true"
      );
    }
  });

  test("設定は開いている間そうと分かる", async ({ page }) => {
    await openEditor(page);

    const toggle = page.locator("#settings .settings-panel-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await openSettings(page);

    // アイコンなので文字で「開いている」と言えない。状態は名前と見た目で示す。
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-label", "設定を閉じる");
    await expect(toggle).toHaveClass(/is-active/);
  });

  test("ログインするとアバターに変わり、名前は押すと何が起きるかを言う", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    const logout = page.locator("#logout");
    // 文字の login 名は出さない。アバターの絵だけが並ぶ (#41)。
    await expect(logout.locator("img.account-avatar")).toBeVisible();
    await expect(logout).toHaveAttribute("aria-label", /^ログアウト \(.+\)$/);
    await expect(logout).toHaveText("");
  });
});
