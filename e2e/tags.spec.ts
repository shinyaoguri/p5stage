/**
 * タグ (Phase 5)。主題で作品どうしをつなぐ発見の線。
 *
 * ここで確かめるのは 3 つ。**作品ページからタグ別一覧へ辿れること**、
 * **一覧に公開作品しか出ないこと** (限定公開の種にも同じタグを付けてある)、
 * そして**エディタで付けたタグが作品ページに出ること**。
 *
 * 読み側の種は `e2e/seed.sql` が置く。書き側はログインして自分の作品でやる —
 * 種の作品は別人 (`e2e-author`) のもので、他人の作品にタグは付けられない。
 */

import { expect, test } from "@playwright/test";

import { login, openEditor, openTags, saveNewSketch } from "./helpers";

const AUTHOR = "e2e-author";
const PUBLIC_ID = "E2EPublicSketch0";
const PUBLIC_TITLE = "E2E 公開スケッチ";

/** 種が付けているタグ (公開と限定公開の両方に付いている)。 */
const SEEDED_TAG = "e2e-tag";
/** 公開の種だけが持つ日本語のタグ (URL に percent-encode されて載る)。 */
const SEEDED_JA_TAG = "e2e-別のタグ";

test.describe("タグ別の一覧", () => {
  test("作品ページのタグから一覧へ行ける", async ({ page }) => {
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    await page.locator(".sketch-tags a", { hasText: SEEDED_TAG }).click();

    await expect(page).toHaveURL(`/tags/${SEEDED_TAG}`);
    await expect(page.locator("h1")).toHaveText(SEEDED_TAG);
    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });

  test("日本語のタグも辿れる", async ({ page }) => {
    await page.goto(`/tags/${encodeURIComponent(SEEDED_JA_TAG)}`);

    await expect(page.locator("h1")).toHaveText(SEEDED_JA_TAG);
    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });

  test("同じタグでも限定公開の作品は並ばない", async ({ page }) => {
    await page.goto(`/tags/${SEEDED_TAG}`);

    // 一覧が空だから無い、と区別する。公開の種が出た上で他が無いことを見る。
    await expect(page.getByText(PUBLIC_TITLE)).toBeVisible();
    await expect(page.getByText("E2E 限定公開スケッチ")).toHaveCount(0);
  });

  test("大文字混じりの URL は正典へ 302", async ({ page }) => {
    const response = await page.goto("/tags/E2E-Tag");

    await expect(page).toHaveURL(`/tags/${SEEDED_TAG}`);
    expect(response?.request().redirectedFrom()).not.toBeNull();
    await expect(page.locator("h1")).toHaveText(SEEDED_TAG);
  });

  test("誰も付けていないタグは 404 ではなく空の一覧", async ({ page }) => {
    // タグは自由語彙。「まだ無い」は壊れた URL ではなく普通の状態。
    const response = await page.goto("/tags/e2e-nobody-uses-this");

    expect(response?.status()).toBe(200);
    await expect(page.getByText("公開作品はまだありません")).toBeVisible();
  });

  test("形が違う値は 404 (D1 まで持って行かない)", async ({ page }) => {
    const response = await page.goto(`/tags/${"a".repeat(31)}`);

    expect(response?.status()).toBe(404);
    expect(response?.headers()["cache-control"]).toBe("no-store");
  });
});

test.describe("タグを付ける", () => {
  test("保存するまでは書けず、理由が読める", async ({ page }) => {
    await openEditor(page);
    await login(page);

    // ボタン自体は押せる。押せないボタンにすると、マウスだけの人に理由を
    // 伝える場所が無くなる (操作列の `title` は名前と決めてある)。
    await openTags(page);

    await expect(page.locator("#tags-note")).toHaveText(
      /まだ保存されていません/
    );
    // タグの置き場は D1 の作品なので、器ができるまで書かせない。
    await expect(page.locator("#tags-input")).toBeDisabled();
    await expect(page.locator("#tags-confirm")).toBeDisabled();
  });

  test("付けたタグが作品ページに出て、その一覧に並ぶ", async ({ page }) => {
    await openEditor(page);
    await login(page);
    const id = await saveNewSketch(page, "E2E タグを付ける", "public");

    await openTags(page);
    // 大文字と語間の空白は正規化される (`normalizeTag`)。付けた形のままでは
    // 出ないことも一緒に見る。
    await page.locator("#tags-input").fill("E2E Fresh, E2E-実験");
    await page.locator("#tags-confirm").click();
    await expect(page.locator("#tags-dialog")).toBeHidden();

    await page.goto(`/s/${id}`);
    const tags = page.locator(".sketch-tags a");
    await expect(tags).toHaveText(["e2e-fresh", "e2e-実験"]);

    await tags.first().click();
    await expect(page).toHaveURL("/tags/e2e-fresh");
    await expect(
      page.getByRole("link", { name: "E2E タグを付ける" })
    ).toBeVisible();
  });

  test("開き直すと今のタグが入力欄に入っている", async ({ page }) => {
    await openEditor(page);
    await login(page);
    const id = await saveNewSketch(page, "E2E タグを開き直す", "unlisted");

    await openTags(page);
    await page.locator("#tags-input").fill("e2e-keep");
    await page.locator("#tags-confirm").click();
    await expect(page.locator("#tags-dialog")).toBeHidden();

    // 作品を開き直す。付けたタグは D1 から戻ってくる (`/files` の応答)。
    await page.goto(`/edit?sketch=${id}`);
    await openTags(page);
    // 開いた作品は保存済みなので、開いた時点から書ける。
    await expect(page.locator("#tags-input")).toBeEnabled();
    await expect(page.locator("#tags-input")).toHaveValue("e2e-keep");

    // 空にすれば外れる (全置換なので「消す」操作は要らない)。
    await page.locator("#tags-input").fill("");
    await page.locator("#tags-confirm").click();
    await expect(page.locator("#tags-dialog")).toBeHidden();

    await page.goto(`/s/${id}`);
    await expect(page.locator(".sketch-tags")).toHaveCount(0);
  });

  test("多すぎるタグはその場で断る (送る前に直せる)", async ({ page }) => {
    await openEditor(page);
    await login(page);
    await saveNewSketch(page, "E2E タグの上限", "unlisted");

    await openTags(page);
    await page.locator("#tags-input").fill("a, b, c, d, e, f");
    await page.locator("#tags-confirm").click();

    await expect(page.locator("#tags-error")).toHaveText(/5 個まで/);
    // 直せるようにダイアログは開いたまま。
    await expect(page.locator("#tags-dialog")).toBeVisible();
  });
});
