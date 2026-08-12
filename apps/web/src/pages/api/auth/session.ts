/**
 * いまログインしている人を返す。
 *
 * **トークンは絶対に返さない** (ADR 0009)。ブラウザが知ってよいのは
 * 「誰としてログインしているか」だけで、GitHub を叩くのは常に Worker の側。
 */

import type { APIRoute } from "astro";

import { AuthConfigError, currentSession } from "../../../lib/session/context";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  let session;
  try {
    session = await currentSession(request, Date.now());
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }

  const body =
    session === null
      ? { user: null }
      : {
          user: {
            id: session.user.id,
            login: session.user.login,
            avatarUrl: session.user.avatarUrl,
          },
        };

  return Response.json(body, {
    // 人によって内容が変わる応答なので、共有キャッシュに載せない。
    headers: { "Cache-Control": "private, no-store" },
  });
};
