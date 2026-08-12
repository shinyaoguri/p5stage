/**
 * 閲覧者へ中身を配るとき、どの道を通るかの判断 (Phase 2-4 / ADR 0011)。
 *
 * D1 にも R2 にも GitHub にも触らない純ロジック。**ここが「GitHub を叩くかどうか」を
 * 決める場所**なので、取得の都合から切り離して読めるようにしてある。
 */

import type { Sketch } from "./sketch";

/**
 * ポインタを確かめ直す間隔。
 *
 * 作者が GitHub 側で直接編集した場合、Gist に webhook が無いので (要件 6)
 * こちらから見に行くしかない。短くするほど追従は速いが、**変わっていれば**
 * レート制限を消費する (変わっていなければ 304 で無料)。自サービスからの保存は
 * 即座にポインタを進めるので、ここが効くのは GitHub で直接触られた作品だけ。
 */
export const REVALIDATE_AFTER_MS = 10 * 60 * 1000;

/** 中身をどう用意するか。 */
export type DeliveryPlan =
  /** まだ一度も保存していない。エラーではない。 */
  | { readonly kind: "unsaved" }
  /** 作者が GitHub 側で消した (tombstone)。以後 GitHub を叩かない。 */
  | { readonly kind: "deleted" }
  /** 写しがある。`revalidate` が立っていれば裏で確かめ直す。 */
  | {
      readonly kind: "serve";
      readonly revision: string;
      readonly revalidate: boolean;
    }
  /** 写しがまだ無い。GitHub から取って埋める。 */
  | { readonly kind: "fill" };

/** 作品の今の状態から、通る道を決める。 */
export function planDelivery(sketch: Sketch, now: number): DeliveryPlan {
  if (sketch.gistId === null) return { kind: "unsaved" };
  if (sketch.gistDeletedAt !== null) return { kind: "deleted" };
  if (sketch.currentRevision === null) return { kind: "fill" };

  // 一度も確かめていないものは古いものと同じ扱いにする。確かめないまま配り続けると、
  // GitHub 側の削除にも編集にも永久に気付かない。
  const checkedAt = sketch.revisionCheckedAt;
  const stale = checkedAt === null || now - checkedAt >= REVALIDATE_AFTER_MS;

  return { kind: "serve", revision: sketch.currentRevision, revalidate: stale };
}
