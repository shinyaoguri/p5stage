/**
 * サムネイルの置き場と、受け付けてよいかの判断 (Phase 4-4 / ADR 0019)。
 *
 * 実体は配信用の R2 (`CONTENT`)。**正本ではない** — 失っても次の保存で撮り直せる
 * ので、アセット (`BLOBS`) ではなくリビジョンの写しと同じ寿命の側に置く。
 * キーが `(gistId, revision)` なので書いた絵は二度と変わらず、無効化が要らない
 * (`revision-store.ts` と同じ考え方 — ADR 0011)。
 */

import { THUMBNAIL_MIME } from "@p5stage/shared";

import type { Sketch } from "./sketch";

/** キーの前置き。リビジョンの写し (`gists/`) と混ざらないよう分ける。 */
export const THUMBNAIL_KEY_PREFIX = "thumbs/";

/** 1 枚のキー。配信も保存もここだけを見る。 */
export function thumbnailKey(gistId: string, revision: string): string {
  return `${THUMBNAIL_KEY_PREFIX}${gistId}/${revision}.png`;
}

/** 書く。同じキーには同じ絵しか来ないので、上書きを気にしない。 */
export async function putThumbnail(
  bucket: R2Bucket,
  gistId: string,
  revision: string,
  body: Uint8Array
): Promise<void> {
  await bucket.put(thumbnailKey(gistId, revision), body, {
    httpMetadata: { contentType: THUMBNAIL_MIME },
  });
}

/** 受け付けなかった理由。呼び出し側が HTTP の答えに変える。 */
export interface ThumbnailRejection {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/** 受け付けたときの宛先。 */
export interface ThumbnailTarget {
  readonly gistId: string;
  readonly revision: string;
}

/**
 * その作品のその版に、この人が絵を置けるか。
 *
 * D1 にも R2 にも触らない純ロジック (`fork.ts` と同じ切り方)。**版を指定させる**のは、
 * 保存と撮影の間に別のタブがもう一度保存していることがあるため — 指定が今の版と
 * 食い違うなら、それは画面に出ていたのとは違う作品の絵になっている。
 *
 * 所有者しか置けない。作品ページ (閲覧者側) は撮らないので、他人の実行結果が
 * 作者の作品の顔になる経路は存在しない。
 */
export function planThumbnailUpload(
  sketch: Sketch,
  viewerId: number,
  revision: string | null,
  contentType: string | null
): ThumbnailRejection | ThumbnailTarget {
  if (sketch.ownerId !== viewerId) {
    // 存在は漏らさない。他人の作品に対しては「無い」と同じ答えにする。
    return { status: 404, code: "not_found", message: "作品が見つかりません" };
  }
  if (sketch.gistId === null || sketch.currentRevision === null) {
    return {
      status: 409,
      code: "unsaved",
      message: "まだ保存されていない作品にはサムネイルを置けません",
    };
  }
  if (revision === null || revision !== sketch.currentRevision) {
    return {
      status: 409,
      code: "stale_revision",
      message: "配信中の版と一致しません",
    };
  }
  if (declaredMime(contentType) !== THUMBNAIL_MIME) {
    return {
      status: 415,
      code: "unsupported_type",
      message: `サムネイルは ${THUMBNAIL_MIME} だけを受け付けます`,
    };
  }

  return { gistId: sketch.gistId, revision };
}

/** 断りかどうか。 */
export function isThumbnailRejection(
  value: ThumbnailRejection | ThumbnailTarget
): value is ThumbnailRejection {
  return "status" in value;
}

/** `Content-Type` から形式だけを取り出す (`charset` などは落とす)。 */
function declaredMime(header: string | null): string | null {
  if (header === null) return null;
  return header.split(";")[0]?.trim().toLowerCase() ?? null;
}
