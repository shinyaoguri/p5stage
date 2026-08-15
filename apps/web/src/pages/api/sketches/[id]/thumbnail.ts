/**
 * サムネイルの受け取り (Phase 4-4 / ADR 0019)。
 *
 * 送ってくるのは**作者のエディタ**だけ。実行中の canvas を撮れるのは実行環境で、
 * それを本体まで運ぶ経路は `PreviewHost.capture()` しか無い (ADR 0007)。
 *
 * クォータには載せない。利用者が持ち込んだ素材ではなく、保存に付いてこちらが
 * 作らせた派生物なので、`user_blobs` の計上 (ADR 0003) の外に置く。
 */

import { MAX_THUMBNAIL_BYTES, THUMBNAIL_MIME } from "@p5stage/shared";
import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { matchesDeclaredType } from "../../../../lib/assets/sniff";
import {
  jsonError,
  rejectForeignOrigin,
  requireSession,
} from "../../../../lib/http/api";
import { readBodyLimited } from "../../../../lib/http/body";
import { isSketchId } from "../../../../lib/sketches/id";
import {
  getSketch,
  setThumbnailRevision,
} from "../../../../lib/sketches/store";
import {
  isThumbnailRejection,
  planThumbnailUpload,
  putThumbnail,
} from "../../../../lib/sketches/thumbnail";

export const prerender = false;

/** 人によって答えが変わる口なので、共有キャッシュに載せない。 */
function privateJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const POST: APIRoute = async ({ request, params, url }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const id = params.id ?? "";
  const sketch = isSketchId(id) ? await getSketch(env.DB, id) : null;
  if (sketch === null) {
    return jsonError(404, "not_found", "作品が見つかりません");
  }

  // 置いてよいかの判断は純ロジックに寄せる (D1 も R2 も見ない)。
  const plan = planThumbnailUpload(
    sketch,
    auth.session.user.id,
    url.searchParams.get("rev"),
    request.headers.get("Content-Type")
  );
  if (isThumbnailRejection(plan)) {
    return jsonError(plan.status, plan.code, plan.message);
  }

  // 既にその版の絵がある。撮り直しても中身は変わらないので、書かずに終わる。
  if (sketch.thumbnailRevision === plan.revision) {
    return privateJson({ status: "stored", revision: plan.revision }, 200);
  }

  const bytes = await readBodyLimited(request, MAX_THUMBNAIL_BYTES);
  if (bytes === null) {
    return jsonError(413, "too_large", "サムネイルが大きすぎます");
  }
  if (bytes.byteLength === 0) {
    return jsonError(400, "empty", "サムネイルが空です");
  }
  // 申告どおりの形式か。配信側は `nosniff` を付けて申告どおりに配るので、
  // 「png として配るのに png ではない」を受け取りの時点で止める (3-1 と同じ作法)。
  if (!matchesDeclaredType(THUMBNAIL_MIME, bytes)) {
    return jsonError(400, "invalid_image", "PNG として読めません");
  }

  // R2 が先。台帳だけ進むと、指している絵が無い状態 (壊れた og:image) になる。
  await putThumbnail(env.CONTENT, plan.gistId, plan.revision, bytes);
  await setThumbnailRevision(
    env.DB,
    sketch.id,
    auth.session.user.id,
    plan.revision
  );

  return privateJson({ status: "stored", revision: plan.revision }, 201);
};
