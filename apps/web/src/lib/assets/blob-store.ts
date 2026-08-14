/**
 * アセット実体の置き場 (R2)。
 *
 * キーが中身の sha256 なので、**書いたオブジェクトは二度と変わらない**。
 * 差し替えという操作が存在しないため、過去リビジョンは当時のアセットのまま再現される
 * (ADR 0003)。配信の写しを置く `revision-store.ts` とは寿命も GC の規則も違うので、
 * バケットを分けてある。
 */

import type { AssetMime } from "@p5stage/shared";

/**
 * 1 年間の再検証なしキャッシュ。中身が変わらないので上限まで効かせてよい。
 *
 * 保存時 (`putBlob`) と配信時 (`pages/a/[sha256]/[name].ts`) の両方で使う。
 * R2 に載っている値をそのまま返すのではなく配信側でも明示するのは、**何を
 * 付けて配っているかをコードから読めるようにする**ため (ADR 0014)。
 */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** blob のキー。台帳の `sha256` と同じ値で引ける。 */
export function blobKey(sha256: string): string {
  return `blobs/${sha256}`;
}

/**
 * 実体を書く。
 *
 * 同じキーへの書き込みは必ず同じ中身になるので、既にあっても上書きしてよい
 * (「途中まで書いて失敗した」を上書きで直せる利点の方が大きい)。
 */
export async function putBlob(
  bucket: R2Bucket,
  sha256: string,
  body: Uint8Array,
  mime: AssetMime
): Promise<void> {
  await bucket.put(blobKey(sha256), body, {
    httpMetadata: {
      contentType: mime,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    },
  });
}

/**
 * 実体があるか。
 *
 * 台帳 (D1) が正本なので通常の判断はそちらで足りる。これは**台帳にあるのに
 * 実体が無い**という食い違いを扱うため (3-5 の GC と、上げ直しの判断で要る)。
 */
export async function blobExists(
  bucket: R2Bucket,
  sha256: string
): Promise<boolean> {
  return (await bucket.head(blobKey(sha256))) !== null;
}
