/**
 * 認可画面へ送り出す (ADR 0009)。
 *
 * popup は使わない。トップレベルのリダイレクトなら cookie が確実に載り、
 * ポップアップブロックの考慮も要らない。編集中の内容は Phase 1-6 のドラフト
 * (IndexedDB) が持っているので、離脱して戻っても失われない。
 */

import type { APIRoute } from "astro";

import { buildAuthorizeUrl } from "../../../lib/github/oauth";
import { buildStateCookie } from "../../../lib/session/cookie";
import {
  AuthConfigError,
  callbackUrl,
  readOAuthConfig,
} from "../../../lib/session/context";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  let config;
  try {
    config = readOAuthConfig();
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }

  // CSRF 対策。同じ値を cookie にも置き、戻ってきたときに突き合わせる。
  // cookie は `__Host-` なので、実行オリジン (same-site) からは書き換えられない。
  const state = crypto.randomUUID();

  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: callbackUrl(url),
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl,
      "Set-Cookie": buildStateCookie(state),
      // 認可画面への入口を中間キャッシュに残さない。
      "Cache-Control": "no-store",
    },
  });
};
