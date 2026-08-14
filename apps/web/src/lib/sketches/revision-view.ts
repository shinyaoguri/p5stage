/**
 * 作品ページが `?rev=` をどう扱うかの判断 (Phase 4-1 / ADR 0016)。
 *
 * D1 にも R2 にも GitHub にも触らない純ロジック。`delivery-plan.ts` と同じ考えで、
 * **どの版を出すか**の判断を取得の都合から切り離して読めるようにしてある。
 */

import type { Sketch } from "./sketch";

/** 作品ページに並べる履歴の件数。 */
export const REVISION_LIST_LIMIT = 20;

/**
 * リビジョン SHA の形。
 *
 * GitHub の Gist が返すのは 16 進 40 桁だが、ここは**存在の確認ではなく足切り**で、
 * 実際にその版があるかは台帳が答える (`findRevision`)。桁を決め打ちにすると
 * Git のハッシュが SHA-256 に移った日に開けなくなるので、形だけを見る。
 */
const REVISION_PATTERN = /^[0-9a-f]{7,64}$/;

export function isRevisionSha(value: string): boolean {
  return REVISION_PATTERN.test(value);
}

/** 作品ページが出すもの。 */
export type RevisionView =
  /** 今配信している版 (`?rev=` 無し)。 */
  | { readonly kind: "current" }
  /** 今の版を指す `?rev=` が付いていた。クエリの無い正典 URL へ寄せる。 */
  | { readonly kind: "canonical" }
  /**
   * 過去の版。台帳と R2 だけで解決する (GitHub へは行かない)。
   *
   * `gistId` を持たせるのは、この道に来た時点で作品に Gist が付いていることが
   * 決まっているため (呼び出し側で null を外す作業が要らなくなる)。
   */
  | {
      readonly kind: "past";
      readonly revision: string;
      readonly gistId: string;
    }
  /** 形が違う・そもそも履歴を持てない状態。作品ページと同じ 404 に揃える。 */
  | { readonly kind: "unknown" };

/**
 * `?rev=` の値から、どの版を出すかを決める。
 *
 * **履歴を持てない状態では過去の版も出さない。**
 *
 * - Gist が付いていない (未保存・切り離し済み): 写しは R2 に残っていても、この作品の
 *   ものとして配る根拠がもう無い (ADR 0012 の「切り離しは閲覧者から見て何かが変わる」)
 * - 作者が GitHub 側で消した (tombstone): 「削除されました」と言いながら過去の中身を
 *   全部配る形にはしない
 */
export function planRevisionView(
  sketch: Sketch,
  revParam: string | null
): RevisionView {
  if (revParam === null) return { kind: "current" };

  const gistId = sketch.gistId;
  if (gistId === null || sketch.gistDeletedAt !== null) {
    return { kind: "unknown" };
  }
  if (!isRevisionSha(revParam)) return { kind: "unknown" };

  // 同じ中身に 2 つの URL を持たせない (キャッシュも検索結果も割れる)。
  if (revParam === sketch.currentRevision) return { kind: "canonical" };

  return { kind: "past", revision: revParam, gistId };
}

/**
 * 履歴を引く Gist。引けない状態なら null。
 *
 * 引かない条件は `planRevisionView` が `unknown` を返す条件と同じ。**開けない版を
 * 並べない**ことが履歴の約束 (ADR 0016) なので、判断を 1 か所に寄せておく。
 */
export function listableGistId(sketch: Sketch): string | null {
  if (sketch.gistDeletedAt !== null) return null;
  return sketch.gistId;
}
