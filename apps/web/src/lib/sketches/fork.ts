/**
 * 作品をフォークしてよいか、GitHub 側で何をするかの判断 (Phase 4-3 / ADR 0018)。
 *
 * D1 にも GitHub にも触らない純ロジック (`gist-adopt.ts` と同じ切り方)。取得と
 * 書き込みは API ルートの担当。
 */

import { validateSketchFiles, type SketchFiles } from "@p5stage/shared";

import { checkManifest } from "../assets/manifest-check";

/** 判断に要る、GitHub から読んだ**親の** Gist の姿。 */
export interface ForkSource {
  /** Gist の持ち主 (GitHub の数値 ID)。読めなければ null。 */
  readonly ownerId: number | null;
  readonly files: SketchFiles;
  /** 大きすぎて中身を取れなかったファイル名。 */
  readonly truncated: readonly string[];
}

/**
 * GitHub 側で何をするか。
 *
 * - `fork` fork API を叩く。`Forked from` が付き、blob は GitHub 側で共有される
 *   (コピー不要の O(1) — 要件 3.4)
 * - `copy` 新しい Gist を作る。**自分の Gist は自分で fork できない** (#44) ので、
 *   自分の作品から派生を作るときはこちら
 */
export type ForkRoute = "fork" | "copy";

/**
 * 断る理由。呼び出し側は**種類で HTTP に移す** (文言で分岐させない)。
 *
 * - `incomplete` 中身を全部は読めなかった (1MB 超)
 * - `invalid_files` スケッチとして成り立たないファイル構成
 * - `invalid_manifest` assets.json が読めない・アセットとコードの名前がぶつかる
 * - `unknown_asset` 実体の無いアセットを参照している。**ここでは返さない** —
 *   台帳 (D1) にしか無い事実なので判定は呼び出し側。理由 → HTTP の対応表を
 *   1 か所に保つために種類だけ置いてある (`gist-adopt.ts` と同じ形)
 */
export type ForkRejectionReason =
  "incomplete" | "invalid_files" | "invalid_manifest" | "unknown_asset";

export type ForkDecision =
  | {
      readonly kind: "accept";
      readonly route: ForkRoute;
      /**
       * 参照している実体 (重複なし)。**所有の確認と計上は呼び出し側**。
       *
       * フォークはここで**他人の blob を自分に計上する**唯一の経路になる
       * (ADR 0003 の「持ち込んだ時点で満額計上する」)。
       */
      readonly digests: readonly string[];
    }
  | {
      readonly kind: "reject";
      readonly reason: ForkRejectionReason;
      readonly message: string;
    };

/**
 * フォークしてよいかを決める。
 *
 * **経路は Gist の持ち主で分ける。** 回避したい制約は GitHub 側のもの
 * (自分の Gist を fork すると 422) であって、D1 の所有ではない。D1 で分けると、
 * 両者がずれたときに 422 がそのまま利用者へ出る。持ち主が読めない Gist (匿名) は
 * 「自分ではない」= fork 経路に倒す。
 *
 * **中身を全部読めていない Gist は断る** (ADR 0012 決定 3 と同じ理由)。GitHub 側は
 * 1MB 超のファイルも複製するが、こちらは中身を持っていないので、配信の写しが
 * 欠けた姿で作られ、フォーク先の次の保存でそのファイルだけが消える。
 *
 * **アセットの一覧も保存経路と同じ厳しさで見る。** 読めないまま受け入れると、
 * 次の保存が必ず断られる作品が残る。実体があるかまでは見られない (台帳が要る)
 * ので、確かめる相手の sha256 を `digests` に出して呼び出し側へ渡す。
 */
export function planSketchFork(
  source: ForkSource,
  viewerId: number
): ForkDecision {
  if (source.truncated.length > 0) {
    return {
      kind: "reject",
      reason: "incomplete",
      message: `大きすぎて読み込めないファイルがあるため、この作品はフォークできません (1MB まで): ${source.truncated.join(", ")}`,
    };
  }

  const errors = validateSketchFiles(source.files);
  if (errors.length > 0) {
    return {
      kind: "reject",
      reason: "invalid_files",
      message: `元の作品をそのまま複製できません: ${errors.join(" / ")}`,
    };
  }

  const manifest = checkManifest(source.files);
  if (manifest.kind === "invalid") {
    return {
      kind: "reject",
      reason: "invalid_manifest",
      message: `元の作品のアセット一覧が読めません: ${manifest.message}`,
    };
  }

  return {
    kind: "accept",
    route: source.ownerId === viewerId ? "copy" : "fork",
    digests: manifest.kind === "ok" ? manifest.digests : [],
  };
}
