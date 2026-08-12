/**
 * login に依存しない恒久リンク (Phase 2-4)。
 *
 * 常に正典 URL (`/@<login>/<sketchId>`) へ 302 する。作者が GitHub で改名しても
 * 生きている URL が要る場面 (外部に貼る・引用する) 用。Gist は `<username>/<id>` が
 * 改名で 404 になるので、その穴をこちらで塞ぐ (ADR 0011)。
 *
 * HTML を返さないのでページではなくルートにしてある。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { sketchPath } from "../../lib/sketches/content";
import { isSketchId } from "../../lib/sketches/id";
import { getSketchWithOwner } from "../../lib/sketches/store";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";
  // 形が違う値を D1 まで持って行かない。存在の確認ではなく足切り。
  const sketch = isSketchId(id) ? await getSketchWithOwner(env.DB, id) : null;

  // 見つからなければ正典 URL も分からない。作品ページと同じ 404 に揃える
  // (他人のものだった場合も同じ — 存在を漏らさない)。
  if (sketch === null) return new Response(null, { status: 404 });

  return new Response(null, {
    status: 302,
    headers: {
      Location: sketchPath(sketch.ownerLogin, sketch.id),
      // 持ち主が改名すれば飛び先が変わる。共有キャッシュに固定させない。
      "Cache-Control": "no-store",
    },
  });
};
