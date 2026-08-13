/**
 * 受け取ったバイト列が、申告された形式と矛盾しないかを見る。
 *
 * allowlist (要件 3.3) はあくまで**申告**の絞り込みで、`Content-Type: image/png` と
 * 書いて中身に別物を入れるのは誰にでもできる。配信側は `nosniff` を付けて申告どおりの
 * 型として配るので、それだけで文書として解釈されることはないが、
 * **「png を保存したのに png ではない」という壊れ方をアップロードの時点で止める**
 * ために、署名の決まっている形式は先頭バイトを確かめる。
 *
 * 署名を持たないテキスト形式 (json / csv / txt / obj / gltf) は素通しする。
 * ここで中身の妥当性まで見ようとすると、
 * 「読み込めるが仕様外」を弾いて利用者を困らせるだけになるため。
 */

import type { AssetMime } from "@p5stage/shared";

/** 先頭が一致するか。 */
function startsWith(bytes: Uint8Array, pattern: readonly number[]): boolean {
  if (bytes.length < pattern.length) return false;
  return pattern.every((byte, index) => bytes[index] === byte);
}

/** 指定位置が ASCII 文字列と一致するか。 */
function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/** RIFF コンテナ (webp / wav) か。offset 8 に形式名が入る。 */
function isRiff(bytes: Uint8Array, form: string): boolean {
  return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, form);
}

/**
 * MP3 か。ID3 タグ付きと、タグ無しでフレーム同期から始まるものの両方がある。
 * 同期は 11 bit すべて 1 (0xFF に続くバイトの上位 3 bit が 1)。
 */
function isMpegAudio(bytes: Uint8Array): boolean {
  if (asciiAt(bytes, 0, "ID3")) return true;
  if (bytes.length < 2) return false;
  return bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
}

/**
 * SFNT 形式のフォントか。
 * TrueType は `00 01 00 00` か `true`、CFF を積んだ OpenType は `OTTO`。
 * 拡張子と中身の対応は実運用で入れ替わっている (CFF の .ttf も珍しくない) ので、
 * otf / ttf のどちらでも SFNT であれば通す。
 */
function isSfnt(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) ||
    asciiAt(bytes, 0, "true") ||
    asciiAt(bytes, 0, "ttcf") ||
    asciiAt(bytes, 0, "OTTO")
  );
}

/** 署名で見分けられる形式だけを持つ。ここに無い形式は素通しになる。 */
const SIGNATURES: Partial<Record<AssetMime, (bytes: Uint8Array) => boolean>> = {
  "image/png": (bytes) =>
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  "image/gif": (bytes) =>
    asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a"),
  "image/webp": (bytes) => isRiff(bytes, "WEBP"),
  "model/gltf-binary": (bytes) => asciiAt(bytes, 0, "glTF"),
  "audio/mpeg": isMpegAudio,
  "audio/wav": (bytes) => isRiff(bytes, "WAVE"),
  "audio/ogg": (bytes) => asciiAt(bytes, 0, "OggS"),
  "font/otf": isSfnt,
  "font/ttf": isSfnt,
};

/** 中身が申告された形式と矛盾しないか。署名を持たない形式は常に true。 */
export function matchesDeclaredType(
  mime: AssetMime,
  bytes: Uint8Array
): boolean {
  const signature = SIGNATURES[mime];
  return signature === undefined || signature(bytes);
}
