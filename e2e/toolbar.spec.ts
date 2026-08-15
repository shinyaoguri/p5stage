/**
 * 操作列のアイコンボタン (#41 の 2) の回帰テスト。
 *
 * **アイコンだけのボタンは、名前を付け忘れても見た目には出ない。** 押せば動くので
 * 手で触っても気付けず、気付くのは支援技術で使う人だけになる。組み立てを
 * `makeToolbarButton()` に寄せた意味がここにあるので、名前が付いていることを
 * 実物の DOM で見る。
 */

import { expect, test, type Page } from "@playwright/test";

import { FAKE_VIEWER } from "./fake-github/viewer";
import {
  accountMenuToggle,
  expectGeneration,
  login,
  openAccountMenu,
  openEditor,
  openSettings,
  openWorkMenu,
  settingsDrawer,
  toasts,
  typeIntoEditor,
  warningIndicator,
} from "./helpers";

/** 操作列に出ているアイコンボタン。 */
function toolbarButtons(page: Page) {
  return page.locator(".chrome .toolbar-btn:visible");
}

test.describe("操作列", () => {
  test("アイコンボタンはすべて名前を持つ", async ({ page }) => {
    await openEditor(page);

    const buttons = toolbarButtons(page);
    // 出るのは 全画面 / アカウント の 2 つだけ。作品に属する操作は中央の作品
    // メニューへ (#87 の段階 3)、保存は中央の名前の右へ (段階 4)、設定は
    // アカウントメニューの中へ移した (段階 5)。
    await expect(buttons).toHaveCount(2);

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

  test("直すまで続く条件は警告アイコンに残り、押すと読み直せる", async ({
    page,
  }) => {
    await openEditor(page);
    // 条件が無いうちは影も形も無い。
    await expect(warningIndicator(page)).toBeHidden();

    // 読めない作品を開く。開けなかったことに気付かないまま書き続けると、手元の
    // 中身で上書きしてしまう — **直すまで続く条件**として出しっぱなしにする。
    await page.goto("/edit?sketch=AAAAAAAAAAAAAAAA");
    await expectGeneration(page, 1);

    await expect(warningIndicator(page)).toBeVisible();
    await expect(warningIndicator(page)).toHaveAttribute("data-count", "1");
    await expect(warningIndicator(page)).toHaveAttribute(
      "aria-label",
      /ログインが必要です/
    );
    // 出しっぱなしにするものなので、トーストには載せない (#41 の 5 の線引き)。
    await expect(toasts(page, "error")).toHaveCount(0);

    // 打鍵では消えない。消えるのは条件そのものが無くなったときだけ。
    await typeIntoEditor(page, 'console.log("e2e-warned");');
    await expect(warningIndicator(page)).toBeVisible();

    // ホバーで読み切れない文面は、押せばトーストで読み直せる。
    await warningIndicator(page).click();
    await expect(toasts(page, "error")).toContainText("ログインが必要です");
  });

  /**
   * 設定はアカウントメニューの中 (#87 の段階 5)。
   *
   * 操作列に歯車は無く、メニューを開いて初めて出る。**押すとメニューは畳まれ**、
   * 開いたドロワーが右上ごと覆う — 閉じる口は面の中にある (settings.spec)。
   */
  test("設定はアカウントメニューの中にあり、押すと面が開く", async ({
    page,
  }) => {
    await openEditor(page);

    // 畳んだ先はメニューの中なので、開くまでは見えない。
    const toggle = page.locator("#settings-toggle");
    await expect(toggle).toBeHidden();

    await openAccountMenu(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // 縦に並ぶ行なので、絵だけでなく文字も持つ (アイコンだけの行は見分けが付かない)。
    await expect(toggle.locator(".menu-item-label")).toHaveText(
      "エディタの設定を開く"
    );

    await openSettings(page);

    // 面が開いた = 開く口の役目は終わり、メニューは畳まれる。
    await expect(toggle).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // 面の中の閉じる口で戻すと、メニューはまた開ける (押す場所は変わっていない)。
    await settingsDrawer(page).locator(".settings-panel-close").click();
    await openAccountMenu(page);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle.locator(".menu-item-label")).toHaveText(
      "エディタの設定を開く"
    );
  });

  /**
   * 全画面 (#87 の段階 1)。
   *
   * 押した先が「入る」と「出る」で入れ替わるボタンなので、**行きと帰りの両方**を
   * 見る。片道だけ通しても、戻れないまま閉じ込める作りに気付けない。
   */
  test("全画面ボタンは押すと入り、もう一度押すと戻る", async ({ page }) => {
    await openEditor(page);

    const button = page.locator("#fullscreen");
    await expect(button).toHaveAttribute("data-fullscreen", "false");
    await expect(button).toHaveAttribute("aria-label", "全画面表示");

    await button.click();
    await expect(button).toHaveAttribute("data-fullscreen", "true");
    // アイコンの向きが変わるだけでは「押すと戻る」ことが読み上げに伝わらない。
    await expect(button).toHaveAttribute("aria-label", "全画面表示を終わる");
    // **押されたままには見せない** (#87 の段階 5)。`is-active` は面を開いている印で、
    // 全画面は面ではない。広がったことは画面全体が示している。
    await expect(button).not.toHaveClass(/is-active/);
    expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(
      true
    );

    await button.click();
    await expect(button).toHaveAttribute("data-fullscreen", "false");
    await expect(button).toHaveAttribute("aria-label", "全画面表示");
    expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(
      false
    );
  });

  test("ログインするとアバターに変わり、名前は押すと何が起きるかを言う", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    const toggle = accountMenuToggle(page);
    // 文字の login 名は出さない。アバターの絵だけが並ぶ (#41)。
    await expect(toggle.locator("img.account-avatar")).toBeVisible();
    await expect(toggle).toHaveAttribute(
      "aria-label",
      /^アカウントメニューを開く \(.+\)$/
    );
    await expect(toggle).toHaveText("");
  });
});

/**
 * 作品メニュー (#87 の段階 3)。
 *
 * 中央のバー (実行ボタンと名前の右) から下りる面。**押せない操作を出したまま
 * にしない**という線引きは、操作列にあった頃と同じでなければならない —
 * 場所を移したときに条件付きの出し入れごと落とすのがいちばん起きやすい壊れ方。
 */
test.describe("作品メニュー", () => {
  test("開くと作品の操作が並ぶ (まだ保存していない作品では置き場への道が出ない)", async ({
    page,
  }) => {
    await openEditor(page);

    const toggle = page.locator("#work-menu-toggle");
    const menu = page.locator("#work-menu");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();

    await toggle.click();

    await expect(menu).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-label", "作品メニューを閉じる");

    // この作品に何かを足す操作は、保存前から押せる。
    await expect(menu.locator("#tags")).toBeVisible();
    await expect(menu.locator("#assets-toggle")).toBeVisible();
    // 置き場 (作品ページ・Gist) はまだ無いので出ない。
    await expect(menu.locator("#page-link")).toBeHidden();
    await expect(menu.locator("#gist-link")).toBeHidden();
    await expect(menu.locator("#detach")).toBeHidden();
    // 出るものが後ろに無いので、その手前の区切りも出ない (線だけが残らない)。
    await expect(menu.locator(".menu-separator")).toBeHidden();
  });

  test("項目を押すと閉じる (開いた面に重ならない)", async ({ page }) => {
    await openEditor(page);
    await openWorkMenu(page);

    await page.locator("#tags").click();

    await expect(page.locator("#tags-dialog")).toBeVisible();
    await expect(page.locator("#work-menu")).toBeHidden();
  });

  test("Escape で閉じ、フォーカスが開閉ボタンへ戻る", async ({ page }) => {
    await openEditor(page);
    await openWorkMenu(page);

    await page.keyboard.press("Escape");

    await expect(page.locator("#work-menu")).toBeHidden();
    // 閉じた先で行き場を失わない (キーボードだけで使う人はここが頼り)。
    await expect(page.locator("#work-menu-toggle")).toBeFocused();
  });
});

/**
 * アカウントメニュー。
 *
 * **アバターは押しても壊れない場所**でなければならない。以前はこのボタン自身が
 * ログアウトを兼ねていて、押した瞬間にセッションが切れていた (#56)。
 * ここが落ちたら、その事故が戻っている。
 */
test.describe("アカウントメニュー", () => {
  test("アバターを押すとメニューが開く (押しただけではログアウトしない)", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    const toggle = accountMenuToggle(page);
    const menu = page.locator("#account-menu");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();

    await toggle.click();

    await expect(menu).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveClass(/is-active/);
    // 押しただけではログインしたまま (ここが #56 の事故)。
    await expect(page.locator("#login")).toBeHidden();
    // アイコンだけでは分からない「誰としてログインしているか」を文字で読める。
    await expect(menu).toContainText(FAKE_VIEWER.login);
    // ログアウトの口はこの中にある。
    await expect(menu.locator("#logout")).toBeVisible();
  });

  test("Escape で閉じ、フォーカスがアバターへ戻る", async ({ page }) => {
    await openEditor(page);
    await login(page);

    const toggle = accountMenuToggle(page);
    await toggle.click();
    await expect(page.locator("#account-menu")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator("#account-menu")).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // 閉じた先で行き場を失わない (キーボードだけで使う人はここが頼り)。
    await expect(toggle).toBeFocused();
  });

  test("メニューの外を押すと閉じる", async ({ page }) => {
    await openEditor(page);
    await login(page);

    await accountMenuToggle(page).click();
    await expect(page.locator("#account-menu")).toBeVisible();

    // スケッチの面 (メニューの外) を押す。
    await page.locator("#stage").click({ position: { x: 10, y: 10 } });

    await expect(page.locator("#account-menu")).toBeHidden();
    // 外を押しただけでログアウトはしない。
    await expect(accountMenuToggle(page)).toBeVisible();
  });
});
