/**
 * 準リアルタイム同期閲覧 (Phase 4-2 / ADR 0017)。
 *
 * **Phase 4 の完了条件そのもの** — 作者がライブコーディングし、閲覧者が数秒遅れで
 * 追従できる。ここでしか確かめられないのは、本体 → Durable Object → 別ブラウザ、
 * という**プロセスとオリジンをまたぐ往復**が実際につながること。
 * WebSocket の upgrade も、Astro のルートから 101 を返せるかも、実ブラウザでしか出ない。
 *
 * 閲覧側を `browser.newContext()` で開くのは、**cookie を持たない人**として見るため
 * (`flow.spec.ts` と同じ理由)。同期は閲覧の機能なので、ログインは要らない。
 */

import { expect, test, type Page } from "@playwright/test";

import { FAKE_VIEWER } from "./fake-github/viewer";
import {
  login,
  openEditor,
  saveAgain,
  saveNewSketch,
  typeIntoEditor,
} from "./helpers";
import { WEB_ORIGIN } from "./origins";

/** 種として置いてある作品 (e2e/seed.sql)。 */
const AUTHOR = "e2e-author";
const PUBLIC_ID = "E2EPublicSketch0";
const UNLISTED_ID = "E2EUnlistedSkt01";
const PREV = "e2e0000000000000000000000000000000000000";

/**
 * 1 行で書ける形にする (Monaco の自動補完と喧嘩しないため — helpers.ts)。
 *
 * 実行面にも印を残す。**コード表示が入れ替わっただけでは「実行し直した」ことに
 * ならない**ので、スケッチ自身が書いた文字をフレームの中から読む。
 */
function sketchCode(marker: string): string {
  return `function setup(){ createCanvas(120,120); background(20); noLoop(); createDiv('${marker}').id('marker'); }`;
}

/**
 * 実行中のスケッチが残した印。
 *
 * ランナーはダブルバッファなので、差し替えの最中は古いフレームも残っている。
 * **どれか 1 つに新しい印があること**を見る (古い方が消えるのを待つ話ではない)。
 */
async function sketchMarkers(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const frame of page.frames()) {
    if (frame.url() !== "about:srcdoc") continue;
    try {
      const text = await frame.evaluate(
        () => document.getElementById("marker")?.textContent ?? null
      );
      if (text !== null) found.push(text);
    } catch {
      // 差し替えの途中でフレームが外れた。次の呼び出しで見直す。
    }
  }
  return found;
}

/** 作品ページの根。`data-live-state` は購読の状態 (JS が書く)。 */
function sketchPage(page: Page) {
  return page.locator(".sketch-page");
}

test.describe("同期閲覧", () => {
  test("作者の保存に、開いたままの作品ページが追従する", async ({
    page,
    browser,
  }) => {
    await openEditor(page);
    await login(page);
    await typeIntoEditor(page, sketchCode("LIVE_BEFORE"));
    const id = await saveNewSketch(page, "同期する作品", "public");

    const viewer = await browser.newContext({ baseURL: WEB_ORIGIN });
    const viewerPage = await viewer.newPage();
    try {
      await viewerPage.goto(`/@${FAKE_VIEWER.login}/${id}`);

      await expect(
        viewerPage.locator('.sketch-file[data-file="sketch.js"]')
      ).toContainText("LIVE_BEFORE");
      await expect
        .poll(() => sketchMarkers(viewerPage), { timeout: 15_000 })
        .toContain("LIVE_BEFORE");

      // **繋がるまで待つ。** 繋がる前に保存すると知らせを受け取れず、
      // 「追いつき」(接続直後に今の版を引く道) の方を試すことになってしまう。
      await expect(sketchPage(viewerPage)).toHaveAttribute(
        "data-live-state",
        "live"
      );
      await expect(viewerPage.locator(".sketch-live")).toBeVisible();

      // 作者が書き直して保存する。
      await typeIntoEditor(page, sketchCode("LIVE_AFTER"));
      await saveAgain(page);

      // 閲覧者は**リロードせずに**新しい版を受け取る。
      await expect(
        viewerPage.locator('.sketch-file[data-file="sketch.js"]')
      ).toContainText("LIVE_AFTER");
      // 実行し直されている (コード表示の差し替えだけでは足りない)。
      await expect
        .poll(() => sketchMarkers(viewerPage), { timeout: 15_000 })
        .toContain("LIVE_AFTER");
    } finally {
      await viewer.close();
    }
  });

  test("最新の版を開いた画面は購読につながる", async ({ page }) => {
    // 種の作品で見る (ログイン不要 = 購読の鍵は sketchId だけ — ADR 0017)。
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}`);

    await expect(sketchPage(page)).toHaveAttribute("data-live", "1");
    await expect(sketchPage(page)).toHaveAttribute("data-live-state", "live");
  });

  test("過去の版を開いた画面は追従しない", async ({ page }) => {
    // `?rev=` を指定した閲覧者を勝手に最新へ動かさない (ADR 0017)。
    await page.goto(`/@${AUTHOR}/${PUBLIC_ID}?rev=${PREV}`);

    await expect(page.locator(".sketch-past")).toBeVisible();
    await expect(sketchPage(page)).not.toHaveAttribute("data-live", "1");
    // 印そのものが出ない (状態が変わっても現れない)。
    await expect(page.locator(".sketch-live")).toHaveCount(0);
  });

  test("ブラウザ以外からは購読できない", async ({ page }) => {
    // Origin も Sec-Fetch-Site も無い要求は通さない (ADR 0008)。読み取りしか
    // しない口だが、**開けば Durable Object が起きる** = 費用が動く。
    const response = await page.request.get(`/api/sketches/${PUBLIC_ID}/live`, {
      headers: { Upgrade: "websocket" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });
});

test.describe("版の中身を返す口", () => {
  test("公開作品の版は不変として配る", async ({ request }) => {
    const response = await request.get(
      `/api/sketches/${PUBLIC_ID}/revisions/${PREV}`
    );

    expect(response.status()).toBe(200);
    // 不変なのは中身そのもの (作品ページの HTML と違って作者名もタイトルも入らない)。
    expect(response.headers()["cache-control"]).toContain("immutable");

    const body = (await response.json()) as {
      revision: string;
      files: Record<string, string>;
    };
    expect(body.revision).toBe(PREV);
    expect(body.files["sketch.js"]).toContain("E2E_SKETCH_MARKER_PREV");
  });

  test("限定公開の版は共有キャッシュに載せない", async ({ request }) => {
    // 「URL を知る人だけ」は、共有キャッシュに載った時点で崩れる (ADR 0011)。
    const response = await request.get(
      `/api/sketches/${UNLISTED_ID}/revisions/${PREV}`
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  });

  test("知らない版と形の違う版は 404", async ({ request }) => {
    const unknown = await request.get(
      `/api/sketches/${PUBLIC_ID}/revisions/${"a".repeat(40)}`
    );
    expect(unknown.status()).toBe(404);

    const malformed = await request.get(
      `/api/sketches/${PUBLIC_ID}/revisions/..%2F..%2Fsecret`
    );
    expect(malformed.status()).toBe(404);
  });

  test("今の版は、その作品を開いている人が引ける", async ({ request }) => {
    // 再接続の取りこぼしを埋める口。返すのは SHA だけ。
    const response = await request.get(`/api/sketches/${PUBLIC_ID}/head`);

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect((await response.json()) as { revision: string }).toEqual({
      revision: "e2e1111111111111111111111111111111111111",
    });
  });
});
