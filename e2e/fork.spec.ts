/**
 * 他人の作品をフォークする (Phase 4-3 / #44 / ADR 0018)。
 *
 * ここでしか確かめられないのは 4 つ。**GitHub 側で別の Gist が立つこと**
 * (fork API を通った証拠)、**中身がそのまま複製されること**、**系譜が出ること**、
 * そして**限定公開の親の URL を漏らさないこと**。
 *
 * 相手は種の作品 (`e2e/seed.sql`)。作者は 424242 / e2e-author で、ログインする
 * 偽利用者とは別人 — それが「自分の Gist は自分で fork できない」(#44) を
 * 踏まない条件になる。偽 GitHub 側にも同じ `gist_id` で実物が置いてある。
 */

import { expect, test, type Page } from "@playwright/test";

import {
  expectGeneration,
  login,
  openEditor,
  saveAgain,
  saveNewSketch,
  typeIntoEditor,
} from "./helpers";

const AUTHOR = "e2e-author";
/** 公開の親。 */
const FOREIGN_ID = "E2EForeignSkt001";
/** 限定公開の親。 */
const FOREIGN_UNLISTED_ID = "E2EForeignUnl001";
/** アセットを使う親。 */
const FOREIGN_ASSET_ID = "E2EForeignAst001";
/** 旧版を持つ作品 (過去の版ではフォークさせない)。 */
const PAST_REVISION = "e2e0000000000000000000000000000000000000";
const WITH_HISTORY_ID = "E2EPublicSketch0";

/** 作品ページが指している Gist。別の Gist が立ったかを見るのに使う。 */
function gistHref(page: Page): Promise<string | null> {
  return page
    .locator(".sketch-meta a", { hasText: "Gist" })
    .getAttribute("href");
}

/** セッションを引き終えるまで待つ。「まだ」と「出ない」は見た目が同じ。 */
async function settled(page: Page): Promise<void> {
  await expect(
    page.locator(".sketch-actions[data-ready='true']")
  ).toBeAttached();
}

/**
 * フォークして、できた作品の ID を返す。
 *
 * 押すと確認が出る (押した瞬間には何も作らない — 取り消せない操作なので)。
 */
async function fork(page: Page, sketchId: string): Promise<string> {
  await page.goto(`/@${AUTHOR}/${sketchId}`);
  await settled(page);

  await page.locator("#sketch-fork-button").click();
  await expect(page.locator("#fork-dialog")).toBeVisible();
  await page.locator("#fork-confirm").click();

  // 行き先はエディタ。フォークの次にやることは編集なので。
  await page.waitForURL(/\/edit\?sketch=/);
  const id = new URL(page.url()).searchParams.get("sketch") ?? "";
  expect(id).not.toBe("");
  return id;
}

test.describe("フォーク", () => {
  test("他人の作品をフォークすると、自分の作品として中身ごと複製される", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    const forkedId = await fork(page, FOREIGN_ID);

    await page.goto(`/s/${forkedId}`);
    // 中身は元の作品と同じ (R2 の写しまで届いている)。
    await expect(
      page.locator('.sketch-file[data-file="sketch.js"]')
    ).toContainText("E2E_SKETCH_MARKER");

    // **別の Gist が立っている** = fork API を通った (元の Gist を指していない)。
    expect(await gistHref(page)).not.toContain("e2e-gist-foreign");

    // 系譜が出る。GitHub 側の `Forked from` ではなく D1 が正典 (#44)。
    await expect(page.locator(".sketch-lineage")).toContainText(
      "E2E 他人のスケッチ"
    );
    await expect(page.locator(".sketch-lineage a")).toHaveAttribute(
      "href",
      `/@${AUTHOR}/${FOREIGN_ID}`
    );

    // 自分の作品になったので、出る操作が入れ替わる。
    await settled(page);
    await expect(page.locator("#sketch-edit-link")).toBeVisible();
    await expect(page.locator("#sketch-fork-button")).toHaveCount(0);
  });

  test("限定公開の作品から派生しても、その URL は出さない", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    const forkedId = await fork(page, FOREIGN_UNLISTED_ID);

    await page.goto(`/s/${forkedId}`);
    /*
     * 親の URL を出すと、`s-maxage` のエッジ越しに**その URL を知らない全員へ
     * 配られる**。`unlisted` は URL が防御そのもの (要件 3.4)。
     */
    await expect(page.locator(".sketch-lineage")).toContainText(
      "限定公開の作品から派生"
    );
    await expect(page.locator(".sketch-lineage a")).toHaveCount(0);

    // 公開範囲は元を引き継ぐ (fork した Gist も secret になる — #44)。
    await expect(page.locator(".sketch-warning")).toContainText("限定公開");
  });

  test("アセットを使う作品をフォークすると、実体を引き継いでそのまま保存できる", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);

    await fork(page, FOREIGN_ASSET_ID);
    await expectGeneration(page, 1);

    /*
     * **保存が通ること自体が、計上できている証拠**。
     *
     * 保存経路は「自分に計上されていない実体を参照するマニフェスト」を断る (3-2)。
     * フォークが `user_blobs` に行を増やしていなければ、この保存は 400 で落ちる
     * (種の実体は誰にも計上されていない状態から始まる)。
     */
    await typeIntoEditor(page, "// FORKED_ASSET_SKETCH");
    await saveAgain(page);
  });

  test("自分の作品は、フォークではなく複製として新しい作品にできる", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);
    const id = await saveNewSketch(page, "複製のもと", "public");

    await page.goto(`/s/${id}`);
    await settled(page);
    const sourceGist = await gistHref(page);

    /*
     * **自分の Gist は自分で fork できない** (#44)。GitHub 上のフォークにならない
     * ので、「フォーク」とは名乗らない (名乗ると嘘になる)。
     */
    await expect(page.locator("#sketch-fork-button")).toHaveCount(0);
    await page.locator("#sketch-copy-button").click();
    await expect(page.locator("#fork-dialog")).toBeVisible();
    await page.locator("#fork-confirm").click();

    await page.waitForURL(/\/edit\?sketch=/);
    const copiedId = new URL(page.url()).searchParams.get("sketch") ?? "";
    expect(copiedId).not.toBe(id);

    await page.goto(`/s/${copiedId}`);
    // 新しい Gist ができている (元を PATCH したのではない = 履歴を伸ばしていない)。
    expect(await gistHref(page)).not.toBe(sourceGist);
    // 系譜は D1 が持つ。GitHub 側にリンクが無くても閲覧体験は同じ (#44)。
    await expect(page.locator(".sketch-lineage")).toContainText("複製のもと");
  });

  test("過去の版を見ているときは出さない", async ({ page }) => {
    await openEditor(page);
    await login(page);

    // fork API は版を選べず、必ず最新から分かれる。見ているものと違う結果に
    // なるので、`?rev=` を指定している人にはボタンを出さない。
    await page.goto(`/@${AUTHOR}/${WITH_HISTORY_ID}?rev=${PAST_REVISION}`);
    await settled(page);

    await expect(page.locator("#sketch-fork-button")).toHaveCount(0);
  });

  test("未ログインでは出ない", async ({ page }) => {
    await page.goto(`/@${AUTHOR}/${FOREIGN_ID}`);
    await settled(page);

    await expect(page.locator("#sketch-fork-button")).toHaveCount(0);
  });
});
