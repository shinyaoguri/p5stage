/**
 * 同期配信の購読口 (Phase 4-2 / ADR 0017)。
 *
 * 作品を開いている閲覧者が、作者の保存で版が進んだことを受け取るための WebSocket。
 * ここがやるのは「誰に開くか」を決めることだけで、配るのは Durable Object。
 *
 * **ログインは要らない。** 引く鍵は sketchId で、これは作品ページを開ける条件と
 * 同じ (要件 3.4)。`unlisted` は「URL を知る人は見られる」という約束なので、
 * 購読の入口にだけ別の強度を要求しても守るものが増えない。
 *
 * 資格情報は preview オリジンへ渡らない (ADR 0007 / 0008)。購読するのは**本体側**で、
 * ランナーはこの口を知らない。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { jsonError, rejectForeignOrigin } from "../../../../lib/http/api";
import { isSketchId } from "../../../../lib/sketches/id";
import { getSketch } from "../../../../lib/sketches/store";

export const prerender = false;

/** 見つからない。**他人のものだった場合もこれを返す** (存在を漏らさない)。 */
function notFound(): Response {
  return jsonError(404, "not_found", "作品が見つかりません");
}

export const GET: APIRoute = async ({ request, url, params }) => {
  if (request.headers.get("Upgrade") !== "websocket") {
    return jsonError(
      426,
      "upgrade_required",
      "この口は WebSocket でのみ使えます"
    );
  }

  // 読み取りしかしない口だが、出どころは確かめる。**他サイトに埋め込まれた
  // 作品ページから購読されると、こちらの Durable Object が起こされる** —
  // 状態は変わらなくても費用は動くので、書き込み口と同じ守りを通す (ADR 0008)。
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  // 存在しない作品にチャネルを開かない。開くと、当てずっぽうの ID を並べるだけで
  // Durable Object をいくつでも作れてしまう。
  const sketch = await getSketch(env.DB, id);
  if (sketch === null) return notFound();

  const channel = env.SKETCH_CHANNEL;
  return channel.get(channel.idFromName(id)).fetch(request);
};
