/**
 * サムネイルの配信 (Phase 4-4 / ADR 0019)。
 *
 * **本体とは別のホストからしか出さない** (middleware.ts)。中身は他者のコードが
 * 描いた画素なので、アセット (`/a/`) と同じ扱いにする — 本体のオリジンから
 * 利用者由来のバイト列を配らない (ADR 0014)。
 *
 * 台帳 (D1) は引かない。鍵が `(gistId, revision)` で不変なので、R2 にあるかどうかが
 * そのまま答えになる。作品ページ側が `thumbnail_revision` を見て URL を出すかどうかを
 * 決めており、ここは「あるものを配る」だけでよい。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { IMMUTABLE_CACHE_CONTROL } from "../../../lib/assets/blob-store";
import { isGistId } from "../../../lib/sketches/gist-ref";
import { isRevisionSha } from "../../../lib/sketches/revision-view";
import { thumbnailKey } from "../../../lib/sketches/thumbnail";

export const prerender = false;

/** URL に付ける拡張子。SNS のカードは `Content-Type` を見ない実装があるため付ける。 */
const SUFFIX = ".png";

/**
 * 配信のヘッダ。アセット (`/a/`) と同じ作法で揃える。
 *
 * 中身は PNG だけだが、`nosniff` と `Content-Security-Policy` は同じように重ねる。
 * 他者の中身を返す口はどれも同じ守りにしておく方が、抜けに気付きやすい。
 */
function deliveryHeaders(etag: string): Headers {
  return new Headers({
    "Content-Type": "image/png",
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
  });
}

/** 見つからない。中身を返す口なので理由は説明しない。 */
function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export const GET: APIRoute = async ({ request, params }) => {
  const gistId = params.gistId ?? "";
  const file = params.revision ?? "";
  if (!file.endsWith(SUFFIX)) return notFound();

  const revision = file.slice(0, -SUFFIX.length);
  // 形が違う値を R2 まで持って行かない。存在の確認ではなく足切り。
  if (!isGistId(gistId) || !isRevisionSha(revision)) return notFound();

  const object = await env.CONTENT.get(thumbnailKey(gistId, revision), {
    // 条件付き GET は R2 に解釈させる (規則を 2 通り持たない)。
    onlyIf: request.headers,
  });
  if (object === null) return notFound();

  const headers = deliveryHeaders(object.httpEtag);
  if (!("body" in object)) return new Response(null, { status: 304, headers });

  return new Response(object.body, { status: 200, headers });
};
