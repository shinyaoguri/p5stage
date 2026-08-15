/**
 * トップページ (Phase 5)。公開作品の新着ギャラリー。
 *
 * ここで確かめるのは**未ログインで作品を発見できること**と、一覧の選定 —
 * 出るのは「開けば中身が出る公開作品」だけで、限定公開・未保存・削除済みは
 * 公開範囲や状態を理由に落ちること (`listPublicSketches`)。
 *
 * 作品は種 (e2e/seed.sql) だけで足りる。出ない側の種の時刻も今にしてあるので、
 * 「LIMIT の外に落ちたから出なかった」という偽陰性はない。
 */

import { expect, test } from "@playwright/test";

/** 種として置いてある作品 (e2e/seed.sql)。 */
const PUBLIC_TITLE = "E2E 公開スケッチ";
const PUBLIC_ID = "E2EPublicSketch0";
const AUTHOR = "e2e-author";

/** 種のサムネイルが指す版 (e2e/seed.sql の `thumbnail_revision`)。 */
const SEED_REVISION = "e2e1111111111111111111111111111111111111";

test.describe("トップページ", () => {
  test("未ログインで公開作品が新着に並び、カードから作品ページへ行ける", async ({
    page,
  }) => {
    await page.goto("/");

    const card = page.getByRole("link", { name: PUBLIC_TITLE });
    await expect(card).toBeVisible();
    await expect(card).toContainText(AUTHOR);

    await card.click();

    await expect(page).toHaveURL(`/@${AUTHOR}/${PUBLIC_ID}`);
    await expect(page.locator("h1")).toHaveText(PUBLIC_TITLE);
  });

  test("限定公開・未保存・削除済みの作品は並ばない", async ({ page }) => {
    await page.goto("/");

    // 一覧が空だから無い、と区別する。公開の種が出た上で他が無いことを見る。
    await expect(page.getByText(PUBLIC_TITLE)).toBeVisible();

    await expect(page.getByText("E2E 限定公開スケッチ")).toHaveCount(0);
    await expect(page.getByText("E2E 未保存スケッチ")).toHaveCount(0);
    await expect(page.getByText("E2E 削除済みスケッチ")).toHaveCount(0);
  });

  test("カードに配信ホストからのサムネイルが出る", async ({ page }) => {
    await page.goto("/");

    const thumb = page
      .getByRole("link", { name: PUBLIC_TITLE })
      .locator("img.thumb");

    // `/t/` は配信ホストからしか出ない (ADR 0014) ので、src は絶対 URL になる。
    await expect(thumb).toHaveAttribute(
      "src",
      new RegExp(
        `^http.+/t/e2e10000000000000000000000000001/${SEED_REVISION}\\.png$`
      )
    );
    // 属性が正しいだけでなく、実際に絵が返って描画されること (種は 1x1 の PNG)。
    await expect
      .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  });

  test("「スケッチを作る」がエディタへ向く", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("link", { name: "スケッチを作る" })
    ).toHaveAttribute("href", "/edit");
  });
});
