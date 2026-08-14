/**
 * 外部にある自分の Gist を、作品として受け入れてよいかの判断 (Phase 2-6)。
 *
 * 受け入れると**その Gist がそのまま正本になる** (ADR 0012)。中身を複製して別の Gist を
 * 作るのではないので、受け入れた瞬間から保存も配信もその Gist を指す。だから
 * 「受け入れてよいか」は保存経路と同じ厳しさで見る必要がある。
 *
 * D1 にも GitHub にも触らない純ロジック。取得と書き込みは API ルートの担当。
 */

import { validateSketchFiles, type SketchFiles } from "@p5stage/shared";

import { checkManifest } from "../assets/manifest-check";
import { titleFromDescription } from "./gist-payload";
import type { Visibility } from "./sketch";

/** 判断に要る、GitHub から読んだ Gist の姿。 */
export interface AdoptionSource {
  /** Gist の持ち主 (GitHub の数値 ID)。読めなければ null。 */
  readonly ownerId: number | null;
  readonly isPublic: boolean;
  readonly description: string;
  readonly files: SketchFiles;
  /** 大きすぎて中身を取れなかったファイル名。 */
  readonly truncated: readonly string[];
}

/**
 * 断る理由。呼び出し側は**種類で HTTP に移す** (文言で分岐させない)。
 *
 * - `not_owner` 自分の Gist ではない
 * - `incomplete` 中身を全部は読めなかった (1MB 超)
 * - `invalid_files` スケッチとして成り立たないファイル構成
 * - `invalid_manifest` assets.json が読めない・アセットとコードの名前がぶつかる
 * - `unknown_asset` 自分が所有していない実体を参照している (#65)。**ここでは返さない** —
 *   所有は台帳 (D1) にしか無いので、判定は呼び出し側。理由 → HTTP の対応表を
 *   1 か所に保つために種類だけ置いてある
 */
export type AdoptionRejectionReason =
  | "not_owner"
  | "incomplete"
  | "invalid_files"
  | "invalid_manifest"
  | "unknown_asset";

export type AdoptionDecision =
  | {
      readonly kind: "accept";
      readonly title: string;
      readonly visibility: Visibility;
      /**
       * 参照している実体 (重複なし)。**所有の確認は呼び出し側**。
       *
       * ここは D1 に触らないので、「誰の所有を確かめればよいか」までを出す
       * (`manifest-check.ts` と同じ切り方 — ADR 0003 の 3-2 補足)。
       */
      readonly digests: readonly string[];
    }
  | {
      readonly kind: "reject";
      readonly reason: AdoptionRejectionReason;
      readonly message: string;
    };

/**
 * 受け入れてよいかを決める。
 *
 * **自分の Gist に限る**。他人の Gist を正本にすると、その作品は保存できない
 * (書き込めるのは本人のトークンだけ — 要件 5.2) うえ、相手が中身を変えれば
 * こちらの作品も変わる。他人の作品は Gist fork API と D1 の系譜で扱う (#44 / Phase 4)。
 * ここで中身を複製して受け入れてしまうと、その `Forked from` と blob 共有を捨てる
 * ことになる。
 *
 * **中身を全部読めていない Gist も断る**。受け入れると配信の写しがその欠けた姿で
 * 作られ、次の保存では読めなかったファイルだけが取り残される。サービス側で
 * 1MB 以下を強制する前提 (要件 6) から外れた Gist は、外に置いたままの方が安全。
 *
 * **アセットの一覧 (assets.json) も保存経路と同じ厳しさで見る** (#65)。読めない
 * まま受け入れると、次の保存が必ず断られる作品が残る。所有までは見られない
 * (台帳が要る) ので、確かめる相手の sha256 を `digests` に出して呼び出し側へ渡す。
 */
export function planGistAdoption(
  source: AdoptionSource,
  viewerId: number
): AdoptionDecision {
  if (source.ownerId !== viewerId) {
    return {
      kind: "reject",
      reason: "not_owner",
      message: "取り込めるのは自分の Gist だけです",
    };
  }

  if (source.truncated.length > 0) {
    return {
      kind: "reject",
      reason: "incomplete",
      message: `大きすぎて読み込めないファイルがあります (1MB まで): ${source.truncated.join(", ")}`,
    };
  }

  const errors = validateSketchFiles(source.files);
  if (errors.length > 0) {
    return {
      kind: "reject",
      reason: "invalid_files",
      message: errors.join(" / "),
    };
  }

  const manifest = checkManifest(source.files);
  if (manifest.kind === "invalid") {
    return {
      kind: "reject",
      reason: "invalid_manifest",
      message: manifest.message,
    };
  }

  return {
    kind: "accept",
    title: titleFromDescription(source.description),
    // 公開範囲は Gist の側で既に決まっている。作成後に変えられない値なので
    // (ADR 0010)、こちらが選ぶのではなく**あちらに合わせる**しかない。
    visibility: source.isPublic ? "public" : "unlisted",
    digests: manifest.kind === "ok" ? manifest.digests : [],
  };
}
