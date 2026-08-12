/**
 * API ルートから見た「今の設定」と「今ログインしている人」。
 *
 * 環境変数の取り出しと鍵の導出をここに集める。各ルートが `env` を直接触ると、
 * 設定漏れの検出が散らばるため。
 */

import { env } from "cloudflare:workers";

import { resolveGitHubOrigins, type GitHubOrigins } from "../github/origins";

import { deriveTokenKey } from "./crypto";
import { readCookie, SESSION_COOKIE } from "./cookie";
import { readSession, type ActiveSession } from "./store";

/** 設定が足りない。開発中に気付けるよう、握り潰さず 500 にする。 */
export class AuthConfigError extends Error {
  constructor(name: string) {
    super(`${name} が設定されていません`);
    this.name = "AuthConfigError";
  }
}

export interface OAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * OAuth の設定を取り出す。
 *
 * 本番は `wrangler.jsonc` の vars と Workers の secret、ローカルは `.dev.vars`。
 * どちらも同じ名前なので、ここでは区別しない。
 *
 * 型を通さずに読むのは、**secret が `wrangler types` の生成物に現れないため**。
 * `wrangler.jsonc` に secret は書けず、手元では `.dev.vars` から拾われて型が付く一方、
 * CI には `.dev.vars` が無いので型が消える (= 手元で通る型検査が CI で落ちる)。
 * 環境によって有無が変わる値なので、型に頼らずここで 1 度だけ実体を確かめる。
 */
export function readOAuthConfig(): OAuthConfig {
  const values = env as unknown as Record<string, string | undefined>;
  const clientId = values.GITHUB_CLIENT_ID;
  const clientSecret = values.GITHUB_CLIENT_SECRET;

  if (!clientId) throw new AuthConfigError("GITHUB_CLIENT_ID");
  if (!clientSecret) throw new AuthConfigError("GITHUB_CLIENT_SECRET");

  return { clientId, clientSecret };
}

/**
 * GitHub の宛先。既定は本物で、差し替えが効くのはローカル向けだけ (ADR 0013)。
 *
 * `GITHUB_TEST_ORIGIN` は **E2E 専用**。本番の `wrangler.jsonc` には置かない。
 */
export function githubOrigins(): GitHubOrigins {
  const values = env as unknown as Record<string, string | undefined>;
  return resolveGitHubOrigins(values.GITHUB_TEST_ORIGIN);
}

/** 認可の戻り先。GitHub の OAuth App に登録した URL と**完全一致**する必要がある。 */
export function callbackUrl(requestUrl: URL): string {
  return new URL("/api/auth/callback", requestUrl.origin).href;
}

/** トークンの封筒を開け閉めする鍵 (ADR 0009)。 */
export function tokenKey(config: OAuthConfig): Promise<CryptoKey> {
  return deriveTokenKey(config.clientSecret);
}

/**
 * 要求からログイン中のセッションを引く。ログインしていなければ null。
 *
 * 返り値にはトークンが入る。**API の応答へそのまま流さないこと** (ADR 0009)。
 */
export async function currentSession(
  request: Request,
  now: number
): Promise<ActiveSession | null> {
  const rawId = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (rawId === null) return null;

  const config = readOAuthConfig();
  return readSession(env.DB, await tokenKey(config), rawId, now);
}
