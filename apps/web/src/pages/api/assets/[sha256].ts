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
  inUseError,
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
  releaseBlob,
  sketchesUsingBlob,
} from "../../../lib/assets/store";
import {
  jsonError,
  rejectForeignOrigin,
  requireSession,
} from "../../../lib/http/api";
import { drainRequestBody } from "../../../lib/http/body";

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

/**
 * 文言に名前を挙げる作品の数。
 *
 * 出すのは 1 件目と残りの件数だけ (`inUseError`) なので、全部を引く必要は無い。
 * これを超える数の作品が同じアセットを使っていると「ほか N 件」は少なめに出るが、
 * 直す手数 (どれか一つでも外れるまで作品から外す) は変わらない。
 */
const REFERER_LIMIT = 20;

/**
 * 所有を手放す (3-4b / 3-5a)。
 *
 * 消えるのは台帳の「誰に計上するか」だけ。実体は残るので、同じ中身をもう一度
 * 持ち込めば転送なしで戻る。回収は 3-5b の GC (詳細は `releaseBlob`)。
 *
 * **自分の作品が今も使っているうちは手放させない** (3-5a)。手放すとその sha256 を
 * 指すマニフェストは次の保存で断られる (3-2) ので、壊れるのは手放した瞬間ではなく
 * 次に保存したとき — 気付けない壊れ方になる。エディタも同じ判断をしているが
 * (3-4b)、あちらが見えるのは**今開いている作品**だけで、別のタブで開いた別の作品は
 * 守れない。ここが最後の守り。
 *
 * 見るのは今配信しているリビジョンだけ (`sketchesUsingBlob`)。作品から外して
 * 保存すれば手放せる。
 */
export const DELETE: APIRoute = async ({ request, url, params }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const sha256 = params.sha256 ?? "";
  if (!isSha256Hex(sha256)) {
    return jsonError(
      400,
      "invalid_input",
      "sha256 は 64 桁の小文字 16 進で指定してください"
    );
  }

  const userId = auth.session.user.id;
  const inUse = inUseError(
    (await sketchesUsingBlob(env.DB, userId, sha256, REFERER_LIMIT)).map(
      (sketch) => sketch.title
    )
  );
  if (inUse !== null) return jsonError(409, "asset_in_use", inUse);

  // 持っていないものを消したと答えると、一覧が古いことに気付けない。
  if (!(await releaseBlob(env.DB, userId, sha256))) {
    return jsonError(404, "not_found", "そのアセットは持っていません");
  }

  return Response.json(
    { usage: await assetUsage(env.DB, userId) },
    { status: 200, headers: { "Cache-Control": "private, no-store" } }
  );
};

export const PUT: APIRoute = async ({ request, url, params }) => {
  const response = await upload(request, url, params.sha256 ?? "");
  // 読まずに弾いた本文を読み切る (#38)。middleware も最後に同じことをするが、
  // **この口がいちばんその形を作りやすい**ので、経緯ごとここに残す
  // (上限を超える本文を弾いた直後など、読み切る量が大きいのもここ)。
  await drainRequestBody(request);
  return response;
};
