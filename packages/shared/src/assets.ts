/**
 * アセット (画像・3D モデル・音声・データ・フォント) の共通定義。
 *
 * 実体は R2 に置く sha256 キーの不変 blob で、参照は Gist 内の assets.json (ADR 0003)。
 * 「受け付ける形式」と「sha256 の求め方」は、アップロードを検証する本体と、
 * 転送を省くために先にハッシュを計算するクライアントと、実行時に MIME を決める
 * ランナーが**同じ答えを出さないと壊れる**ので、ここに 1 つだけ置く。
 */

/**
 * 受け付ける形式と、それを表す拡張子 (要件 3.3 の allowlist)。
 *
 * **SVG と HTML は入れない**。どちらもブラウザが文書として解釈してスクリプトを走らせる
 * 形式で、閲覧者を「アセットの顔をしたページ」へ連れて行ける (ADR 0003)。
 *
 * 拡張子を併記するのは、エディタがファイル名から MIME を決めるため。1 つの形式に
 * 複数の拡張子がある場合、先頭を代表とする。
 */
export const ASSET_TYPES = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "model/obj": [".obj"],
  "model/gltf+json": [".gltf"],
  "model/gltf-binary": [".glb"],
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "audio/ogg": [".ogg"],
  "application/json": [".json"],
  "text/csv": [".csv"],
  "text/plain": [".txt"],
  "font/otf": [".otf"],
  "font/ttf": [".ttf"],
} as const satisfies Record<string, readonly string[]>;

/** 受け付ける MIME。 */
export type AssetMime = keyof typeof ASSET_TYPES;

const ASSET_MIMES = Object.keys(ASSET_TYPES) as AssetMime[];

/**
 * 1 ファイルの上限の既定値 (5MB)。
 *
 * 実際の上限は**ユーザー単位の設定値**で、ここは新規ユーザーに配る初期値
 * (有料プランで引き上げられる構造にする — 要件 3.3)。
 */
export const DEFAULT_MAX_ASSET_BYTES = 5 * 1024 * 1024;

/** ユーザー合計の上限の既定値 (250MB)。上と同じくユーザー単位の設定値の初期値。 */
export const DEFAULT_ASSET_QUOTA_BYTES = 250 * 1024 * 1024;

/** 受け付ける形式か。 */
export function isAssetMime(value: unknown): value is AssetMime {
  return typeof value === "string" && value in ASSET_TYPES;
}

/**
 * ファイル名から MIME を決める。allowlist の外なら null。
 *
 * 拡張子だけで決めるので中身とは無関係。**これは分類であって検証ではない**
 * (実体との突き合わせはアップロードを受ける側の責務)。
 */
export function assetMimeForFileName(name: string): AssetMime | null {
  const lower = name.toLowerCase();
  for (const mime of ASSET_MIMES) {
    for (const extension of ASSET_TYPES[mime]) {
      if (lower.endsWith(extension)) return mime;
    }
  }
  return null;
}

/** アセットとして扱えるファイル名か (テキストのスケッチファイルと区別する)。 */
export function isAssetFileName(name: string): boolean {
  return assetMimeForFileName(name) !== null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * sha256 を小文字 16 進で表した文字列か。
 *
 * 大文字を許さないのは、同じ blob が 2 つのキーで R2 に載るのを防ぐため
 * (content-addressed の一意性は表記の一意性まで含めて成り立つ)。
 */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * バイト列の sha256 を小文字 16 進で返す。
 *
 * 引数を `BufferSource` ではなく `Uint8Array<ArrayBuffer>` に絞ってあるのは、
 * `BufferSource` の定義が DOM と Workers でずれていて、同じ値が本体では通らなく
 * なるため。共有メモリ上のバイト列を渡す用途は無いので、絞っても困らない。
 */
export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
