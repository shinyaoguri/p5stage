/**
 * アセットの配信 (Phase 3-3 / ADR 0014)。
 *
 * ここは**他者がアップロードした中身をそのまま返す**唯一の口で、本体とは別の
 * ホストからしか出さない (middleware.ts)。認証は無く、sha256 を知っていれば誰でも
 * 取れる — マニフェストは公開作品の Gist に載るので、実質公開のものを配っている。
 *
 * 引く鍵は sha256 だけで、**URL のファイル名は使わない**。名前が付いているのは
 * p5 の `loadModel` が拡張子で形式を判定するため (ADR 0014)。
 *
 * 台帳 (D1) は引かない。実体があるかどうかは R2 だけで決まり、台帳から消えた blob を
 * 実際に消すのは GC (3-5) の仕事になる。
 */

import { isAssetMime, isSha256Hex } from "@p5stage/shared";
import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  blobKey,
  IMMUTABLE_CACHE_CONTROL,
} from "../../../lib/assets/blob-store";

export const prerender = false;

/** 形式が分からないときの型。allowlist の外なら中身を推測させない。 */
const FALLBACK_MIME = "application/octet-stream";

/**
 * 配信のヘッダ。
 *
 * - `nosniff`: 申告した形式以外に解釈させない (要件 5.1)。allowlist と署名検査
 *   (3-1) を通っていても、配る側で必ず止める
 * - `Access-Control-Allow-Origin: *`: 実行 iframe は別オリジンで、p5 は画像に
 *   `crossOrigin = "Anonymous"` を付ける。cookie は届かず中身は誰でも取れるので
 *   `*` でよい (ADR 0014)
 * - `Cross-Origin-Resource-Policy`: 別オリジンから読ませるための明示
 * - `Content-Security-Policy`: 万一ブラウザが文書として開いても何も動かさない。
 *   `nosniff` があるので通常は届かない層だが、ここは他者の中身を返す口なので重ねる
 */
function deliveryHeaders(contentType: string, etag: string): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    ETag: etag,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
  });
}

/**
 * 部分応答の範囲。R2 が解釈した範囲を、そのまま `Content-Range` の形に直す。
 *
 * 分岐を `"suffix" in range` で書かないのは、**キーはあるが値が undefined** という
 * 形で返ってくるため (`bytes=0-3` に対して `NaN-39/40` を返して気付いた)。
 * 値そのものを見る。
 */
function contentRange(range: R2Range, size: number): string {
  const suffix = "suffix" in range ? range.suffix : undefined;
  if (typeof suffix === "number") {
    const start = Math.max(size - suffix, 0);
    return `bytes ${start}-${size - 1}/${size}`;
  }

  const offset = ("offset" in range ? range.offset : undefined) ?? 0;
  const length =
    ("length" in range ? range.length : undefined) ?? size - offset;
  return `bytes ${offset}-${offset + length - 1}/${size}`;
}

/** 見つからない。中身を返す口なので理由は説明しない。 */
function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export const GET: APIRoute = async ({ request, params }) => {
  const sha256 = params.sha256 ?? "";
  // 形が違う値を R2 まで持って行かない。大文字を許さないのは、同じ中身が 2 つの
  // キーで載るのを防ぐ規則 (ADR 0003) を配信側でも守るため。
  if (!isSha256Hex(sha256)) return notFound();

  // `Range` と `If-None-Match` / `If-Modified-Since` は R2 に解釈させる。
  // 自前で解析すると、条件付き GET の細かい規則を 2 通り持つことになる。
  const object = await env.BLOBS.get(blobKey(sha256), {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (object === null) return notFound();

  const declared = object.httpMetadata?.contentType;
  const headers = deliveryHeaders(
    isAssetMime(declared) ? declared : FALLBACK_MIME,
    object.httpEtag
  );

  // 条件付き GET が一致した (本文が無い)。同じ ETag だけ返して終わる。
  if (!("body" in object)) {
    return new Response(null, { status: 304, headers });
  }

  // 範囲の要求が無ければ全部返す。`object.range` は要求が無くても入るので、
  // 206 にするかどうかは**要求の有無**で決める。
  if (request.headers.get("Range") === null || object.range === undefined) {
    return new Response(object.body, { status: 200, headers });
  }

  headers.set("Content-Range", contentRange(object.range, object.size));
  return new Response(object.body, { status: 206, headers });
};
