/**
 * 認可画面から戻ってくる口 (ADR 0009)。
 *
 * ここで受け取ったアクセストークンは**ブラウザへ渡さない**。封筒に入れて D1 に置き、
 * ブラウザにはセッション ID だけを cookie で返す。移植元 (canvastage) が
 * インライン script で `window.opener` にトークンを postMessage していた部分は、
 * まるごとこの形に置き換わる。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  exchangeCodeForToken,
  fetchViewer,
  GitHubOAuthError,
} from "../../../lib/github/oauth";
import {
  buildClearedStateCookie,
  buildSessionCookie,
  readCookie,
  STATE_COOKIE,
} from "../../../lib/session/cookie";
import {
  AuthConfigError,
  callbackUrl,
  readOAuthConfig,
  tokenKey,
} from "../../../lib/session/context";
import { createSession } from "../../../lib/session/store";

export const prerender = false;

/** 認可の結果を伝える相手。ログイン導線を置いているページに戻す。 */
const RETURN_PATH = "/edit";

/**
 * 失敗の理由。**固定の語彙に絞る**のは、外から来た文字列をそのまま URL に載せて
 * 画面へ出す経路を作らないため。
 */
type Failure = "denied" | "invalid_state" | "failed";

function redirect(path: string, cookies: readonly string[]): Response {
  const headers = new Headers({ Location: path, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function fail(reason: Failure): Response {
  return redirect(`${RETURN_PATH}?auth=${reason}`, [buildClearedStateCookie()]);
}

export const GET: APIRoute = async ({ request, url }) => {
  // 利用者が認可画面で拒否した場合も、ここに `error` 付きで戻ってくる。
  if (url.searchParams.get("error") !== null) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request.headers.get("Cookie"), STATE_COOKIE);

  // state は 1 往復で使い切る。cookie が無い = 経路を踏んでいない。
  if (code === null || state === null || expectedState === null) {
    return fail("invalid_state");
  }
  if (state !== expectedState) return fail("invalid_state");

  let config;
  try {
    config = readOAuthConfig();
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }

  try {
    const token = await exchangeCodeForToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: callbackUrl(url),
    });
    const viewer = await fetchViewer(token);

    const rawId = await createSession(
      env.DB,
      await tokenKey(config),
      viewer,
      token,
      Date.now()
    );

    return redirect(RETURN_PATH, [
      buildSessionCookie(rawId),
      buildClearedStateCookie(),
    ]);
  } catch (error) {
    if (error instanceof GitHubOAuthError) return fail("failed");
    throw error;
  }
};
