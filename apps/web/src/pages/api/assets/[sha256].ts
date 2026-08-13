/**
 * アセット実体のアップロード。
 *
 * URL に置くのは**中身から決まる sha256** なので、同じ中身は必ず同じ URL に着く。
 * サーバは受け取ったバイト列から自分でハッシュを計算し、URL と一致しなければ捨てる —
 * つまり「どの blob を上書きするか」を送り手が選べない。content-addressed の不変性は
 * この照合で成り立っている (ADR 0003)。
 */

import {
  isAssetMime,
  isSha256Hex,
  sha256Hex,
  type AssetMime,
} from "@p5stage/shared";
import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  assetSizeError,
  quotaError,
  type AssetBlob,
} from "../../../lib/assets/asset";
import { putBlob } from "../../../lib/assets/blob-store";
import { matchesDeclaredType } from "../../../lib/assets/sniff";
import {
  assetUsage,
  findBlob,
  hasClaim,
  recordBlob,
} from "../../../lib/assets/store";
import {
  jsonError,
  rejectForeignOrigin,
  requireSession,
} from "../../../lib/http/api";

export const prerender = false;

/** `Content-Type` から形式を取り出す。allowlist の外なら null。 */
function declaredMime(header: string | null): AssetMime | null {
  if (header === null) return null;
  const mime = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return isAssetMime(mime) ? mime : null;
}

/** `Content-Length` の申告。無い・読めないなら null。 */
function declaredLength(header: string | null): number | null {
  if (header === null) return null;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * 上限までしか読まない。超えたら null。
 *
 * `arrayBuffer()` で丸ごと読んでから長さを見る形にしないのは、`Content-Length` が
 * 嘘でも上限までしかメモリに載せないため。
 */
async function readLimited(
  request: Request,
  limit: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  const body = request.body;
  if (body === null) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * 読まなかった本文を捨てる。
 *
 * ボディを読まないまま応答を返した要求が続くと、ローカルの `wrangler dev` が
 * 落ちることがある (#38)。ここは弾く条件が多く本文も大きいので、
 * 明示的に読み捨ててその形を作らない。
 */
async function discardBody(request: Request): Promise<void> {
  if (request.bodyUsed || request.body === null) return;
  try {
    await request.body.cancel();
  } catch {
    // 送り手が先に切っていることがある。捨てるのが目的なので、失敗しても構わない。
  }
}

async function upload(
  request: Request,
  url: URL,
  sha256: string
): Promise<Response> {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  // 大文字を許すと同じ blob が 2 つのキーで載るので、表記も一意に縛る
  // (小文字へ直さず弾く — 送り手とキーの見え方を揃えるため)。
  if (!isSha256Hex(sha256)) {
    return jsonError(
      400,
      "invalid_input",
      "sha256 は 64 桁の小文字 16 進で指定してください"
    );
  }

  const mime = declaredMime(request.headers.get("content-type"));
  if (mime === null) {
    return jsonError(415, "unsupported_type", "対応していない形式です");
  }

  const userId = auth.session.user.id;
  const usage = await assetUsage(env.DB, userId);

  const declared = declaredLength(request.headers.get("content-length"));
  if (declared !== null) {
    const tooLarge = assetSizeError(declared, usage);
    if (tooLarge !== null) return jsonError(413, "too_large", tooLarge);
  }

  const bytes = await readLimited(request, usage.maxAssetBytes);
  if (bytes === null) {
    return jsonError(
      413,
      "too_large",
      assetSizeError(usage.maxAssetBytes + 1, usage) ?? "大きすぎます"
    );
  }
  if (bytes.byteLength === 0) {
    return jsonError(400, "empty_body", "中身がありません");
  }

  if ((await sha256Hex(bytes)) !== sha256) {
    return jsonError(
      400,
      "digest_mismatch",
      "中身が sha256 と一致しません。もう一度アップロードしてください"
    );
  }

  if (!matchesDeclaredType(mime, bytes)) {
    return jsonError(
      400,
      "content_mismatch",
      `${mime} として読める中身ではありません`
    );
  }

  // 既にある blob なら、台帳にある形式を正とする (同じ中身に 2 つの形式を作らない)。
  const existing = await findBlob(env.DB, sha256);
  const counted = await hasClaim(env.DB, userId, sha256);
  if (!counted) {
    const over = quotaError(bytes.byteLength, usage);
    if (over !== null) return jsonError(413, "quota_exceeded", over);
  }

  const asset: AssetBlob = existing ?? {
    sha256,
    size: bytes.byteLength,
    mime,
    createdAt: Date.now(),
  };

  // R2 → D1 の順で書く。逆にすると「台帳にあるのに実体が無い」が生まれ、
  // 閲覧側から見て壊れた作品になる。この順なら最悪でも台帳に載らない
  // 実体が残るだけで、それは GC (3-5) が拾える。
  await putBlob(env.BLOBS, sha256, bytes, asset.mime);
  await recordBlob(env.DB, userId, asset);

  return Response.json(
    {
      asset,
      usage: counted ? usage : { ...usage, bytes: usage.bytes + asset.size },
    },
    { status: 201, headers: { "Cache-Control": "private, no-store" } }
  );
}

export const PUT: APIRoute = async ({ request, url, params }) => {
  const response = await upload(request, url, params.sha256 ?? "");
  await discardBody(request);
  return response;
};
