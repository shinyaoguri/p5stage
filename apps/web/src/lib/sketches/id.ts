/**
 * 作品 ID の生成。
 *
 * URL に出る値なので短くしたいが、**限定公開 (unlisted) の防御は ID の推測困難性
 * そのもの**なので、短さより推測されないことを優先する (要件 3.4)。
 * 連番にすると他人の作品を数えられてしまうため、乱数から作る。
 *
 * 96 bit を base64url にして 16 文字。総当たりも列挙も現実的でない広さがある。
 */

/** ID の材料。3 の倍数にすると base64 のパディングが出ない。 */
const ID_BYTES = 12;

/** 生成される ID の長さ (文字)。 */
export const SKETCH_ID_LENGTH = 16;

/** URL に置ける形。`+` `/` は経路や検索文字列で意味を持つので使わない。 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateSketchId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * URL から来た値が ID の形をしているか。
 *
 * 形の違うものを D1 まで持って行かないための足切りで、存在の確認ではない。
 */
export function isSketchId(value: string): boolean {
  return new RegExp(`^[A-Za-z0-9_-]{${SKETCH_ID_LENGTH}}$`).test(value);
}
