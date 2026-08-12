/**
 * 認可 URL の組み立てとトークン交換 (要件 3.6 / ADR 0009)。
 *
 * scope が広がると利用者への説明義務の中身が変わるので、`gist` だけであることを固定する。
 * トークン交換は **GitHub が失敗も HTTP 200 で返す**のが罠で、そこを本文で判定できているかを見る。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchViewer,
  GitHubOAuthError,
  OAUTH_SCOPE,
} from "../src/lib/github/oauth";

/** 本物の宛先。差し替えの仕組みは origins.test.ts が見る。 */
const API = "https://api.github.com";
const WEB = "https://github.com";

const OPTIONS = {
  clientId: "Iv1.test",
  clientSecret: "secret",
  code: "the-code",
  redirectUri: "https://p5stage.org/api/auth/callback",
  webOrigin: WEB,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** fetch を 1 回分だけ差し替える。 */
function stubFetch(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response))
  );
}

describe("buildAuthorizeUrl", () => {
  it("GitHub の認可画面を指す", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: OPTIONS.clientId,
        redirectUri: OPTIONS.redirectUri,
        state: "the-state",
        webOrigin: WEB,
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
  });

  it("scope は gist だけ (説明義務の範囲を広げない)", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: OPTIONS.clientId,
        redirectUri: OPTIONS.redirectUri,
        state: "the-state",
        webOrigin: WEB,
      })
    );

    expect(OAUTH_SCOPE).toBe("gist");
    expect(url.searchParams.get("scope")).toBe("gist");
  });

  it("state と戻り先を載せる", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: OPTIONS.clientId,
        redirectUri: OPTIONS.redirectUri,
        state: "the-state",
        webOrigin: WEB,
      })
    );

    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("redirect_uri")).toBe(OPTIONS.redirectUri);
    expect(url.searchParams.get("client_id")).toBe(OPTIONS.clientId);
  });
});

describe("exchangeCodeForToken", () => {
  it("トークンを取り出す", async () => {
    stubFetch(Response.json({ access_token: "gho_example" }));

    await expect(exchangeCodeForToken(OPTIONS)).resolves.toBe("gho_example");
  });

  it("HTTP 200 で返るエラー本文を失敗として扱う", async () => {
    // GitHub は認可コードの使い回しなども 200 + error で返す。
    stubFetch(
      Response.json({
        error: "bad_verification_code",
        error_description: "コードが無効です",
      })
    );

    await expect(exchangeCodeForToken(OPTIONS)).rejects.toBeInstanceOf(
      GitHubOAuthError
    );
  });

  it("トークンが空文字でも失敗にする", async () => {
    stubFetch(Response.json({ access_token: "" }));

    await expect(exchangeCodeForToken(OPTIONS)).rejects.toBeInstanceOf(
      GitHubOAuthError
    );
  });

  it("HTTP エラーも失敗にする", async () => {
    stubFetch(new Response("", { status: 502 }));

    await expect(exchangeCodeForToken(OPTIONS)).rejects.toBeInstanceOf(
      GitHubOAuthError
    );
  });
});

describe("fetchViewer", () => {
  it("同一性の判定に使う id と表示名を返す", async () => {
    stubFetch(
      Response.json({
        id: 1234,
        login: "octocat",
        avatar_url: "https://example.test/a.png",
      })
    );

    await expect(fetchViewer(API, "gho_example")).resolves.toEqual({
      id: 1234,
      login: "octocat",
      avatarUrl: "https://example.test/a.png",
    });
  });

  it("アバターが無くても通る", async () => {
    stubFetch(Response.json({ id: 1234, login: "octocat" }));

    await expect(fetchViewer(API, "gho_example")).resolves.toMatchObject({
      avatarUrl: null,
    });
  });

  it("解釈できない応答は失敗にする", async () => {
    stubFetch(Response.json({ login: "octocat" }));

    await expect(fetchViewer(API, "gho_example")).rejects.toBeInstanceOf(
      GitHubOAuthError
    );
  });

  it("認証に失敗したら失敗にする", async () => {
    stubFetch(new Response("", { status: 401 }));

    await expect(fetchViewer(API, "gho_example")).rejects.toBeInstanceOf(
      GitHubOAuthError
    );
  });
});
