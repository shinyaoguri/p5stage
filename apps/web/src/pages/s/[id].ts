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

import { sketchPath, sketchRevisionPath } from "../../lib/sketches/content";
import { isSketchId } from "../../lib/sketches/id";
import { getSketchWithOwner } from "../../lib/sketches/store";

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id ?? "";
  // 形が違う値を D1 まで持って行かない。存在の確認ではなく足切り。
  const sketch = isSketchId(id) ? await getSketchWithOwner(env.DB, id) : null;

  // 見つからなければ正典 URL も分からない。作品ページと同じ 404 に揃える
  // (他人のものだった場合も同じ — 存在を漏らさない)。
  if (sketch === null) return new Response(null, { status: 404 });

  // 版の指定は飛び先へ持って行く (Phase 4-1)。落とすと、過去の版へのリンクを
  // 恒久リンクの形で貼ったときだけ黙って最新にすり替わる。値が正しいかは
  // 飛び先の作品ページが確かめる。
  const rev = url.searchParams.get("rev");

  return new Response(null, {
    status: 302,
    headers: {
      Location:
        rev === null
          ? sketchPath(sketch.ownerLogin, sketch.id)
          : sketchRevisionPath(sketch.ownerLogin, sketch.id, rev),
      // 持ち主が改名すれば飛び先が変わる。共有キャッシュに固定させない。
      "Cache-Control": "no-store",
    },
  });
};
