/**
 * ログイン導線と認証エンドポイントの回帰テスト (Phase 2-1)。
 *
 * 本物の GitHub へは行かない。認可画面の**手前まで**と、戻ってきた後の口だけを見る。
 * ここで実ブラウザ / 実 Worker でしか確かめられないのは 3 つ。
 *
 * - `gist` scope の意味を、認可へ送り出す前に画面へ出していること (要件 3.6 の義務)
 * - Worker が実際に返す `Set-Cookie` が `__Host-` の要件を満たしていること (ADR 0008)。
 *   属性を 1 つ落とすとサブドメインから cookie を上書きできてしまう
 * - 状態を変える口が、実行オリジン (same-site) からの要求を弾くこと
 *
 * 弾かれる要求に**ボディを付けない**のは、`wrangler dev` の都合。ボディを読まないまま
 * 403 で捨てる要求が続くと、CI (ubuntu) の `wrangler dev` が本文の無い `✘ [ERROR]` を
 * 出して落ちる (手元の macOS では再現しない)。ここで確かめたいのは `Content-Type` の
 * 種類で Astro の保護の効き方が変わることなので、ヘッダだけで足りる。
 */

import { expect, test } from "@playwright/test";

import { openEditor } from "./helpers";
import { PREVIEW_ORIGIN } from "./origins";

/** `__Host-` プレフィックスが成立する条件。1 つでも欠けるとブラウザが受け取らない。 */
const HOST_COOKIE_ATTRIBUTES = ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"];

test.describe("ログインの導線", () => {
  test("未ログインではログインボタンが出る", async ({ page }) => {
    await openEditor(page);

    await expect(page.locator("#login")).toBeVisible();
    // ログアウトの口は出ていない (状態が取り違えられていない)。
    await expect(page.locator("#logout")).toHaveCount(0);
  });

  test("認可へ送り出す前に gist 権限の意味を見せる", async ({ page }) => {
    await openEditor(page);
    await page.locator("#login").click();

    // 要件 3.6: 「全 Gist への書き込み権限になること」と
    // 「本サービスが操作するのは本サービスで作成した Gist だけであること」の両方が要る。
    const consent = page.locator("#login-consent");
    await expect(consent).toBeVisible();
    await expect(consent).toContainText("全 Gist");
    await expect(consent).toContainText("p5stage で作成した Gist だけ");

    // ここを押すまで GitHub へは行かない (押した瞬間に飛ばさない)。
    await expect(consent.locator("a.account-consent-proceed")).toHaveAttribute(
      "href",
      "/api/auth/login"
    );
  });

  test("やめると認可へ進まずに閉じる", async ({ page }) => {
    await openEditor(page);
    await page.locator("#login").click();

    const consent = page.locator("#login-consent");
    await consent.getByRole("button", { name: "やめる" }).click();

    await expect(consent).not.toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
  });
});

test.describe("認証エンドポイント", () => {
  test("/api/auth/login は GitHub へ送り、state を __Host- cookie に置く", async ({
    page,
  }) => {
    // リダイレクトを追うと GitHub の実サイトへ出てしまうので、その手前で止める。
    const response = await page.request.get("/api/auth/login", {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(302);

    const location = response.headers()["location"] ?? "";
    const authorize = new URL(location);
    expect(authorize.origin + authorize.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    // 要求する権限が増えていないこと (増えるなら同意の文面も直す必要がある)。
    expect(authorize.searchParams.get("scope")).toBe("gist");
    expect(authorize.searchParams.get("state")).not.toBeNull();

    const setCookie = response.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("__Host-p5stage_oauth_state=");
    for (const attribute of HOST_COOKIE_ATTRIBUTES) {
      expect(setCookie).toContain(attribute);
    }
    // Domain が付くと __Host- の要件を外れ、実行オリジンから触れるようになる。
    expect(setCookie).not.toContain("Domain=");
  });

  test("state が合わない戻りはセッションを作らない", async ({ page }) => {
    // cookie を持たずに callback を叩く = 経路を踏んでいない要求。
    const response = await page.request.get(
      "/api/auth/callback?code=x&state=y",
      { maxRedirects: 0 }
    );

    expect(response.status()).toBe(302);
    expect(response.headers()["location"]).toContain("auth=invalid_state");
    // 失敗した往復でセッション cookie が出ていないこと。
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      "__Host-p5stage_session="
    );
  });

  test("/api/auth/session は未ログインなら user: null を返す", async ({
    page,
  }) => {
    const response = await page.request.get("/api/auth/session");

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ user: null });
    // 人によって内容が変わるので共有キャッシュに載せない。
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("ログアウトは実行オリジンからの要求を弾く", async ({ page }) => {
    // 実行オリジンは same-site なので、cookie は付いてしまう。
    // SameSite では止まらないぶん、ここで止まらなければ止まる場所が無い (ADR 0008)。
    const response = await page.request.post("/api/auth/logout", {
      headers: { Origin: PREVIEW_ORIGIN, "Sec-Fetch-Site": "same-site" },
    });

    expect(response.status()).toBe(403);
  });

  test("JSON の要求は Astro の保護を素通りするので、自前のガードで弾く", async ({
    page,
  }) => {
    // Astro 組み込みの CSRF 保護 (security.checkOrigin) が Origin を見て弾くのは、
    // **フォーム系の Content-Type か、Content-Type が無い要求だけ**
    // (`astro/dist/core/app/origin-check.js`)。`application/json` は素通りする。
    // これから増える API は JSON で叩くので、実質そこを守るのは自前のガードだけになる。
    const response = await page.request.post("/api/auth/logout", {
      headers: {
        Origin: PREVIEW_ORIGIN,
        "Content-Type": "application/json",
      },
    });

    expect(response.status()).toBe(403);
  });

  test("Origin を伏せた same-site の JSON も弾く", async ({ page }) => {
    // `Origin` が無ければ Astro は同一オリジンと区別できない。`Sec-Fetch-Site` まで
    // 見ているのは自前のガードだけなので、ここが落ちると止める場所が無くなる。
    const response = await page.request.post("/api/auth/logout", {
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-site",
      },
    });

    expect(response.status()).toBe(403);
  });

  test("ログアウトは本体オリジンからなら通る", async ({ page }) => {
    // 本体オリジンのページの中から呼べれば、ブラウザが Origin と Sec-Fetch-Site を
    // 正しく付ける。エディタである必要は無いので、軽いトップページで足りる
    // (Monaco を読み込む必要が無いぶん速く、CI での揺れも小さい)。
    await page.goto("/");

    const status = await page.evaluate(async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      return response.status;
    });

    expect(status).toBe(200);
  });
});
