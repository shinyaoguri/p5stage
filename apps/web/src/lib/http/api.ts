/**
 * API ルートで繰り返す作法をまとめる。
 *
 * 「ログインを要る口」「状態を変える口」の判定を各ルートで書き下すと、1 つ書き忘れた
 * だけで穴になる。ここを通す形に揃えて、書き忘れをレビューで見つけやすくする。
 */

import { AuthConfigError, currentSession } from "../session/context";
import type { ActiveSession } from "../session/store";

import { forbiddenResponse, verifyRequestOrigin } from "./origin-guard";

/** エラー応答。本文の形を 1 つに揃える。 */
export function jsonError(
  status: number,
  error: string,
  message?: string
): Response {
  return Response.json(message === undefined ? { error } : { error, message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * ログイン中のセッションを取り出す。無ければ 401 の応答を返す。
 *
 * 返り値の `session` にはトークンが入る。**応答へそのまま流さないこと** (ADR 0009)。
 */
export async function requireSession(
  request: Request,
  now: number
): Promise<{ session: ActiveSession } | { response: Response }> {
  try {
    const session = await currentSession(request, now);
    if (session === null) {
      return { response: jsonError(401, "unauthorized", "ログインが必要です") };
    }
    return { session };
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return { response: jsonError(500, "misconfigured", error.message) };
    }
    throw error;
  }
}

/**
 * 状態を変える要求の出どころを確かめる (ADR 0008)。
 *
 * Astro 組み込みの CSRF 保護は `application/json` を素通しするので、JSON で叩く
 * API はここを通らないと守られない。
 */
export function rejectForeignOrigin(
  request: Request,
  url: URL
): Response | null {
  return forbiddenResponse(verifyRequestOrigin(request, url.origin));
}

/** 本文を JSON として読む。壊れていれば 400 を返す。 */
export async function readJsonBody(
  request: Request
): Promise<{ body: unknown } | { response: Response }> {
  try {
    return { body: await request.json() };
  } catch {
    return {
      response: jsonError(400, "invalid_body", "本文を解釈できませんでした"),
    };
  }
}
