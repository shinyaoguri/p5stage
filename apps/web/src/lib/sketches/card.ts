/**
 * 一覧に並べるカードの組み立て (Phase 5)。
 *
 * D1 にも DOM にも触らない純ロジック。トップページと作者のページが同じカードを
 * 出すので、**どの作品にどの絵を当てるか**の判断をここ 1 つに置く。
 */

import { thumbnailPath } from "@p5stage/shared";

import { sketchPath } from "./content";
import type { SketchWithOwner } from "./sketch";

/** カード 1 枚に要る値。ここから先は見た目の話 (SketchGrid.astro)。 */
export interface SketchCard {
  readonly href: string;
  readonly title: string;
  readonly ownerLogin: string;
  readonly ownerAvatarUrl: string | null;
  readonly updatedAt: number;
  /** 絵が引けないときは null (カード側はプレースホルダを出す)。 */
  readonly thumbnailUrl: string | null;
}

/**
 * 作品の一覧をカードに直す。
 *
 * サムネイルの URL は**配信オリジンの絶対 URL**にする。`/t/` は配信ホストからしか
 * 出ない (ADR 0014) ため。撮れていない作品 (`thumbnailRevision` が NULL) や、
 * 配信オリジンが未設定の環境では null に倒す — 絵が無くても一覧は成立するので、
 * 壊れた画像を出すより諦める方がよい。
 */
export function toSketchCards(
  sketches: readonly SketchWithOwner[],
  thumbnailOrigin: string | null
): SketchCard[] {
  return sketches.map((sketch) => ({
    href: sketchPath(sketch.ownerLogin, sketch.id),
    title: sketch.title,
    ownerLogin: sketch.ownerLogin,
    ownerAvatarUrl: sketch.ownerAvatarUrl,
    updatedAt: sketch.updatedAt,
    thumbnailUrl:
      sketch.gistId !== null &&
      sketch.thumbnailRevision !== null &&
      thumbnailOrigin !== null
        ? new URL(
            thumbnailPath(sketch.gistId, sketch.thumbnailRevision),
            thumbnailOrigin
          ).href
        : null,
  }));
}
