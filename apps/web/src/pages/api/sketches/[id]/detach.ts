/**
 * 作品を Gist から切り離す (Phase 2-6 / ADR 0012)。
 *
 * 使うのは主に 2 つの場面。
 *
 * - 作者が GitHub 側で Gist を消してしまい、保存も配信も詰んだ作品を作り直す
 * - 公開範囲を変える (Gist は作成後に public / secret を変えられない — ADR 0010)
 *
 * **GitHub には何もしない**。利用者の Gist は利用者のもので、こちらが消す筋合いは
 * 無い。切り離した後もその Gist は GitHub にそのまま残る。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  jsonError,
  rejectForeignOrigin,
  requireSession,
} from "../../../../lib/http/api";
import { isSketchId } from "../../../../lib/sketches/id";
import { detachGist, getSketch } from "../../../../lib/sketches/store";

export const prerender = false;

/** 見つからない。**他人のものだった場合もこれを返す** (存在を漏らさない)。 */
function notFound(): Response {
  return jsonError(404, "not_found", "作品が見つかりません");
}

export const POST: APIRoute = async ({ request, url, params }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  const detached = await detachGist(
    env.DB,
    id,
    auth.session.user.id,
    Date.now()
  );

  if (detached === null) {
    // 切り離す Gist が無かった。**既に切り離されているなら目的は果たされている**ので
    // 成功として返す (押し直しやタブの重複で失敗にしない)。
    const current = await getSketch(env.DB, id);
    if (
      current === null ||
      current.ownerId !== auth.session.user.id ||
      current.gistId !== null
    ) {
      return notFound();
    }
    return Response.json(
      { sketch: current },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return Response.json(
    { sketch: detached },
    { headers: { "Cache-Control": "private, no-store" } }
  );
};
