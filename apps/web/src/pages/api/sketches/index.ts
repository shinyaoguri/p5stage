/**
 * 作品の作成と、自分の作品の一覧。
 *
 * ここで作るのは**器だけ**で、コードはまだ入らない。正本である Gist へ書き出すのは
 * 2-3 の担当で、そのとき `gist_id` が埋まる (ADR 0002)。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  jsonError,
  readJsonBody,
  rejectForeignOrigin,
  requireSession,
} from "../../../lib/http/api";
import {
  parseSketchInput,
  SketchInputError,
} from "../../../lib/sketches/sketch";
import { createSketch, listSketchesByOwner } from "../../../lib/sketches/store";

export const prerender = false;

/** 一覧で返す件数の上限。ページングは一覧 UI を作る Phase 5 で決める。 */
const LIST_LIMIT = 100;

export const POST: APIRoute = async ({ request, url }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const parsed = await readJsonBody(request);
  if ("response" in parsed) return parsed.response;

  try {
    const input = parseSketchInput(parsed.body);
    const sketch = await createSketch(
      env.DB,
      auth.session.user.id,
      input,
      Date.now()
    );
    return Response.json(
      { sketch },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof SketchInputError) {
      return jsonError(400, "invalid_input", error.message);
    }
    throw error;
  }
};

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const sketches = await listSketchesByOwner(
    env.DB,
    auth.session.user.id,
    LIST_LIMIT
  );

  return Response.json(
    { sketches },
    // 人によって内容が変わる応答なので、共有キャッシュに載せない。
    { headers: { "Cache-Control": "private, no-store" } }
  );
};
