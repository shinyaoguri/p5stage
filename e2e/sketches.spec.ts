/**
 * 作品 API の守りの回帰テスト (Phase 2-2)。
 *
 * ログインを要する操作そのものは E2E では踏めない (GitHub の認可が要る) ので、
 * ここで見るのは**誰でも踏める経路**に限る。つまり「ログインしていない人・別オリジン・
 * 形の違う ID」が何を受け取るか。守りが外れたときにいちばん静かに壊れるのがここで、
 * 単体テストからは Worker のルーティングまで見えない。
 *
 * 弾かれる想定の要求にボディを付けないのは #38 の回避 (ボディを読まないまま
 * 403 / 401 で捨てる要求が続くと CI の wrangler dev が落ちる)。
 */

import { expect, test } from "@playwright/test";

import { PREVIEW_ORIGIN } from "./origins";

/** 形は正しいが存在しない ID (長さ 16 の base64url)。 */
const ABSENT_ID = "AAAAAAAAAAAAAAAA";

test.describe("作品 API", () => {
  test("未ログインでは作れない", async ({ page }) => {
    // ページの中から呼ぶ。`page.request` から直接叩くと `Origin` も
    // `Sec-Fetch-Site` も付かず、ログインを見る前に出どころの確認で 403 になる
    // (それも意図どおりの守り。ここで見たいのはその先のログイン確認)。
    await page.goto("/");

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/sketches", { method: "POST" });
      return { status: response.status, body: await response.json() };
    });

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: "unauthorized" });
  });

  test("ブラウザ以外からの作成は出どころ不明として弾く", async ({ page }) => {
    // Origin も Sec-Fetch-Site も無い要求 (curl など) は通さない (ADR 0008)。
    // ブラウザから普通に呼ばれる限り、少なくとも一方は必ず付く。
    const response = await page.request.post("/api/sketches", {
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status()).toBe(403);
  });

  test("未ログインでは自分の作品一覧も引けない", async ({ page }) => {
    const response = await page.request.get("/api/sketches");

    expect(response.status()).toBe(401);
  });

  test("実行オリジンからの作成は 403 で弾く", async ({ page }) => {
    // 他者コードが動くオリジンは same-site なので cookie が付く。
    // ここで止まらなければ、ログイン中の利用者の名前で作品を作られる (ADR 0008)。
    const response = await page.request.post("/api/sketches", {
      headers: {
        Origin: PREVIEW_ORIGIN,
        "Content-Type": "application/json",
      },
    });

    // 401 ではなく 403。出どころの確認はログインの確認より先に来る。
    expect(response.status()).toBe(403);
  });

  test("実行オリジンからの更新も 403 で弾く", async ({ page }) => {
    const response = await page.request.patch(`/api/sketches/${ABSENT_ID}`, {
      headers: {
        Origin: PREVIEW_ORIGIN,
        "Content-Type": "application/json",
      },
    });

    expect(response.status()).toBe(403);
  });

  test("形の違う ID は 404 (D1 まで持って行かない)", async ({ page }) => {
    for (const id of ["short", "../../etc/passwd", "x".repeat(64)]) {
      const response = await page.request.get(
        `/api/sketches/${encodeURIComponent(id)}`
      );
      expect(response.status()).toBe(404);
    }
  });

  test("存在しない作品は 404", async ({ page }) => {
    const response = await page.request.get(`/api/sketches/${ABSENT_ID}`);

    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  test("作品の取得は共有キャッシュに載せない", async ({ page }) => {
    // 限定公開の URL がキャッシュに載ると、ID を知らない相手にも届きうる。
    const response = await page.request.get(`/api/sketches/${ABSENT_ID}`);

    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
