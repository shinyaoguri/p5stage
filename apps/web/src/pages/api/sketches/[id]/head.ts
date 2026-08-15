/**
 * 今配信している版の SHA (Phase 4-2 / ADR 0017)。
 *
 * **再接続の取りこぼしを埋めるためだけの口。** 同期チャネル (Durable Object) は
 * hibernate から戻るたびに記憶を失うので、「最後に流した版」をあちらに持たせない。
 * 代わりに、繋ぎ直した閲覧者がここを 1 回引いて追いつく。真実を持っているのは
 * 最初から D1 のポインタなので、そちらに聞く方が確かでもある。
 *
 * 返すのは SHA だけ。中身は `revisions/[rev].ts` が配る。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { jsonError } from "../../../../lib/http/api";
import { isSketchId } from "../../../../lib/sketches/id";
import { getSketch } from "../../../../lib/sketches/store";

export const prerender = false;

/** 見つからない。**他人のものだった場合もこれを返す** (存在を漏らさない)。 */
function notFound(): Response {
  return jsonError(404, "not_found", "作品が見つかりません");
}

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  const sketch = await getSketch(env.DB, id);
  if (sketch === null) return notFound();

  // **公開作品でも共有キャッシュに載せない。** この値は「今まさに何版か」であって、
  // 数秒古い答えを返すとライブの追従がその分だけ遅れる。引かれるのは再接続の
  // ときだけなので、回数もたかが知れている。
  return Response.json(
    { revision: sketch.currentRevision },
    { headers: { "Cache-Control": "private, no-store" } }
  );
};
