/**
 * サムネイル (実行結果の 1 枚絵) の共通定義。
 *
 * 撮るのは実行環境 (preview)、受け取って置くのは本体 (web)、URL を組み立てるのは
 * 作品ページ — 3 つの場所が同じ形式・同じ上限・同じ URL の作法を見る必要があるので、
 * ここに集める。
 */

/** 形式は PNG 1 つに絞る。読む側 (配信・検証) の分岐を増やさないため。 */
export const THUMBNAIL_MIME = "image/png";

/**
 * 受け取る上限 (バイト)。
 *
 * 撮る側が長辺 {@link MAX_THUMBNAIL_EDGE} まで縮めてから送るので、通常はこれに
 * 遠く及ばない。上限があるのは**送り手を信用しないため** — 口は認証済みでも、
 * 中身のバイト列は利用者のブラウザから来る。
 */
export const MAX_THUMBNAIL_BYTES = 512 * 1024;

/**
 * 縮小後の長辺 (px)。
 *
 * OGP のカード (1200x630 を推奨とする実装が多い) に足りる大きさで、かつ
 * PNG 1 枚が上限に収まる大きさ。**変換は撮る側で済ませて 1 枚だけ持つ**ので
 * (ADR 0019)、ここが実際に配られる唯一の寸法になる。
 */
export const MAX_THUMBNAIL_EDGE = 1200;

/** サムネイルを配る経路の前置き。本体のホストでは出さない (middleware.ts)。 */
export const THUMBNAIL_ROUTE_PREFIX = "/t/";

/**
 * サムネイルの配信パス。
 *
 * 鍵は作品ではなく **(gist, リビジョン)**。中身と同じ単位にすることで、
 * 書いた画像は二度と変わらず (ADR 0011 と同じ考え方)、無効化の仕組みが要らない。
 */
export function thumbnailPath(gistId: string, revision: string): string {
  return `${THUMBNAIL_ROUTE_PREFIX}${gistId}/${revision}.png`;
}

/** 縮小後の寸法。 */
export interface ThumbnailSize {
  readonly width: number;
  readonly height: number;
}

/**
 * 長辺が上限に収まる寸法を返す。描けない大きさ (0 以下・数でない) なら null。
 *
 * **縦横比は保つ**。作品は正方形も縦長もあり、決め打ちの枠に押し込めると
 * 作品ページで見えている絵と違うものが配られる。上限より小さい絵は拡大しない
 * (引き伸ばしても情報は増えず、バイト数だけ増える)。
 */
export function thumbnailSize(
  width: number,
  height: number,
  maxEdge: number = MAX_THUMBNAIL_EDGE
): ThumbnailSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  const scale = Math.min(maxEdge / width, maxEdge / height, 1);
  return {
    // 1px 未満に潰れると canvas が作れないので、必ず 1 は残す。
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
