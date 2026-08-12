/**
 * ログアウト。セッションを D1 から消し、cookie も落とす。
 *
 * 状態を変える口なので `Origin` / `Sec-Fetch-Site` を検証する (ADR 0008)。
 * 実行オリジンは same-site サブドメインにあり、`SameSite=Lax` はそこからの要求を
 * 素通ししてしまうため、cookie の属性だけでは守れない。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  forbiddenResponse,
  verifyRequestOrigin,
} from "../../../lib/http/origin-guard";
import {
  buildClearedSessionCookie,
  readCookie,
  SESSION_COOKIE,
} from "../../../lib/session/cookie";
import { deleteSession } from "../../../lib/session/store";

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const forbidden = forbiddenResponse(verifyRequestOrigin(request, url.origin));
  if (forbidden !== null) return forbidden;

  const rawId = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  // cookie が無くても成功にする。ログアウトは何度呼んでも同じ結果でよい。
  if (rawId !== null) await deleteSession(env.DB, rawId);

  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": buildClearedSessionCookie(),
        "Cache-Control": "no-store",
      },
    }
  );
};
