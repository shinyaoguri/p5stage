/**
 * 保存しようとしているファイル構成のマニフェストを見る (Phase 3-2)。
 *
 * D1 にも R2 にも触らない純ロジック。**所有の確認だけは台帳が要る**ので、
 * ここは「誰の所有を確かめればよいか」(= 参照している sha256) までを出し、
 * 引くのは呼び出し側 (`unclaimedDigests`) に任せる。
 *
 * 正本の Gist に入るファイルなので、壊れたまま通すと**次に開いたときには
 * 直せない形で残る**。保存の手前で断る位置に置いてある。
 */

import {
  manifestDigests,
  manifestNameConflicts,
  readAssetManifest,
  type AssetManifest,
  type SketchFiles,
} from "@p5stage/shared";

export type ManifestCheck =
  /** assets.json が無い。アセットを使っていない作品。 */
  | { readonly kind: "absent" }
  /** 読めない・そのままでは保存させられない。文言はそのまま利用者に見せる。 */
  | { readonly kind: "invalid"; readonly message: string }
  | {
      readonly kind: "ok";
      readonly manifest: AssetManifest;
      /** 参照している blob (重複なし)。所有の確認に使う。 */
      readonly digests: readonly string[];
    };

/**
 * ファイル構成のマニフェストを検査する。
 *
 * 名前の衝突を「読めない」と同じ扱いにしているのは、どちらも**保存した後に
 * 実行できない作品ができる**という同じ結果になるため。3-3 の名前解決は
 * コードのファイルとアセットを 1 つの表で引くので、同じ名前が両方にあると
 * どちらが返るか決まらない。
 */
export function checkManifest(files: SketchFiles): ManifestCheck {
  const result = readAssetManifest(files);
  if (result === null) return { kind: "absent" };
  if (!result.ok) return { kind: "invalid", message: result.message };

  const conflicts = manifestNameConflicts(result.manifest, files);
  if (conflicts.length > 0) {
    return {
      kind: "invalid",
      message: `アセットと同じ名前のファイルがあります: ${conflicts.join(", ")}`,
    };
  }

  return {
    kind: "ok",
    manifest: result.manifest,
    digests: manifestDigests(result.manifest),
  };
}

/**
 * 所有していない blob を参照していたときの文言。
 *
 * sha256 をそのまま出さず件数で言うのは、64 桁の羅列を見せても直しようが無いため。
 * この状態になるのはマニフェストを手で書いたときだけで、直し方は
 * 「そのアセットを上げ直す」しかない。
 */
export function unclaimedMessage(count: number): string {
  return `${count} 件のアセットが見つかりません。アップロードし直してください`;
}
