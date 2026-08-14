/**
 * アセットの申告 (claim) と、自分のアセットの一覧。
 *
 * 中身を送る前に「この sha256 の blob はもう有るか」を訊く口を分けてあるのは、
 * **既にある中身を二度と転送しないため** (ADR 0003 の dedup)。同じ素材を使う作品が
 * 増えても、転送もクォータの実体も 1 つで済む。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  AssetInputError,
  assetSizeError,
  parseAssetClaim,
  quotaError,
  type AssetUsage,
} from "../../../lib/assets/asset";
import { blobExists } from "../../../lib/assets/blob-store";
import {
  assetUsage,
  claimBlob,
  findBlob,
  hasClaim,
  listBlobsByOwner,
} from "../../../lib/assets/store";
import {
  jsonError,
  readJsonBody,
  rejectForeignOrigin,
  requireSession,
} from "../../../lib/http/api";

export const prerender = false;

/** 一覧で返す件数の上限。ページングは管理 UI を作る 3-4 で決める。 */
const LIST_LIMIT = 200;

/** 人によって内容が変わる応答なので、共有キャッシュに載せない。 */
function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const POST: APIRoute = async ({ request, url }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const parsed = await readJsonBody(request);
  if ("response" in parsed) return parsed.response;

  let claim;
  try {
    claim = parseAssetClaim(parsed.body);
  } catch (error) {
    if (error instanceof AssetInputError) {
      return jsonError(400, "invalid_input", error.message);
    }
    throw error;
  }

  const userId = auth.session.user.id;
  const usage = await assetUsage(env.DB, userId);

  // 送る前に上限を伝える。転送し切ってから断るのは利用者の時間を捨てさせるだけ。
  const tooLarge = assetSizeError(claim.size, usage);
  if (tooLarge !== null) return jsonError(413, "too_large", tooLarge);

  // 台帳にあっても**実体を確かめてから**転送を省く (3-5b)。回収は R2 → D1 の順で
  // 消すので、その間に「台帳にあるのに実体が無い」窓ができる。ここで裏を取らないと、
  // 転送を省いた結果アセットの中身だけが存在しない作品が生まれる。
  const blob = await findBlob(env.DB, claim.sha256);
  if (blob === null || !(await blobExists(env.BLOBS, blob.sha256))) {
    // クォータはここでは見ない。申告は幾らでも投げられるので、**計上するのは
    // 実体を受け取ったとき**に揃える。
    return privateJson({ status: "missing", usage });
  }

  // 返すのは申告の値ではなく台帳の値。同じ中身に 2 つの形式を持たせないため、
  // マニフェスト (3-2) に書く値もここに揃える。
  if (await hasClaim(env.DB, userId, blob.sha256)) {
    return privateJson({ status: "stored", asset: blob, usage });
  }

  const over = quotaError(blob.size, usage);
  if (over !== null) return jsonError(413, "quota_exceeded", over);

  await claimBlob(env.DB, userId, blob.sha256, Date.now());

  const next: AssetUsage = { ...usage, bytes: usage.bytes + blob.size };
  return privateJson({ status: "stored", asset: blob, usage: next });
};

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const userId = auth.session.user.id;
  const [usage, assets] = await Promise.all([
    assetUsage(env.DB, userId),
    listBlobsByOwner(env.DB, userId, LIST_LIMIT),
  ]);

  return privateJson({ assets, usage });
};
