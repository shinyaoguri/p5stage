/**
 * 作品 1 件の取得と更新。
 *
 * 取得はログイン不要 (閲覧に会員登録は要らない — 要件 3.4)。`unlisted` も ID を
 * 知っていれば読める。**「URL を知る人は誰でも見られる」がその公開範囲の定義**であって、
 * 隠されているのは ID だけ。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  jsonError,
  readJsonBody,
  rejectForeignOrigin,
  requireSession,
} from "../../../lib/http/api";
import { isSketchId } from "../../../lib/sketches/id";
import {
  parseSketchPatch,
  SketchInputError,
} from "../../../lib/sketches/sketch";
import { getSketch, updateSketch } from "../../../lib/sketches/store";

export const prerender = false;

/** 見つからない。**他人のものだった場合もこれを返す** (存在を漏らさない)。 */
function notFound(): Response {
  return jsonError(404, "not_found", "作品が見つかりません");
}

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";
  // 形が違う値を D1 まで持って行かない。存在の確認ではなく足切り。
  if (!isSketchId(id)) return notFound();

  const sketch = await getSketch(env.DB, id);
  if (sketch === null) return notFound();

  return Response.json(
    { sketch },
    {
      // 限定公開の URL が共有キャッシュに載ると、ID を知らない相手にも届きうる。
      // 公開作品の配信キャッシュは Phase 2-5 でキャッシュ層ごと設計する。
      headers: { "Cache-Control": "private, no-store" },
    }
  );
};

export const PATCH: APIRoute = async ({ request, url, params }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  const parsed = await readJsonBody(request);
  if ("response" in parsed) return parsed.response;

  try {
    const patch = parseSketchPatch(parsed.body);
    const sketch = await updateSketch(
      env.DB,
      id,
      auth.session.user.id,
      patch,
      Date.now()
    );
    // 持ち主でなければ null。「無い」と同じ応答にして、存在を確かめる手掛かりを与えない。
    if (sketch === null) return notFound();

    return Response.json(
      { sketch },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof SketchInputError) {
      return jsonError(400, "invalid_input", error.message);
    }
    throw error;
  }
};
