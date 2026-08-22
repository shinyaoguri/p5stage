/**
 * 配信に載せてよい中身かどうかの判断 (#70)。
 *
 * D1 にも R2 にも GitHub にも触らない純ロジック。照会そのもの
 * (`unclaimedDigests`) は呼び出し側が済ませ、ここは**その結果をどう読むか**だけを
 * 持つ。`delivery-plan.ts` が「GitHub を叩くか」を切り出しているのと同じ理由で、
 * 取得の都合から離して読めるようにしてある。
 *
 * 保存 (`checkManifestOwnership`)・取り込み (`gist-adopt`)・フォークは**利用者の
 * 要求**を断る位置に同じ検査を持っているが、こちらは背景処理が拾った中身が相手で、
 * 断り先の利用者がその場にいない。断り方 (版を進めない) は delivery.ts が決める。
 */

import {
  unclaimedDeliveryMessage,
  type ManifestCheck,
} from "../assets/manifest-check";

export type DeliveryGate =
  /** 配信に載せてよい。 */
  | { readonly kind: "pass" }
  /** 所有していない blob を参照している。作者に見せる文言つき。 */
  | {
      readonly kind: "reject";
      readonly unclaimed: readonly string[];
      readonly message: string;
    };

/**
 * マニフェストの検査結果と所有の照会結果から、配信に載せてよいかを決める。
 *
 * **読めないマニフェスト (`invalid`) は通す。** 断りたいのは「所有していない blob が
 * 配られ、クォータを迂回する」ことで、読めないマニフェストからは sha256 が 1 つも
 * 導出されない (= 参照台帳にも載らず、`/a/<sha256>/<name>` からも配られない)。
 * 通した結果として壊れた作品が配られることはあるが、それは中身が壊れているという
 * 別の話で、ここで一緒に断ると**この経路だけ保存より厳しい**規則になる。
 */
export function gateManifest(
  check: ManifestCheck,
  unclaimed: readonly string[]
): DeliveryGate {
  if (check.kind !== "ok") return { kind: "pass" };
  if (unclaimed.length === 0) return { kind: "pass" };

  return {
    kind: "reject",
    unclaimed,
    message: unclaimedDeliveryMessage(unclaimed.length),
  };
}
