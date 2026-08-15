/**
 * 作品のタグ (Phase 5)。
 *
 * 「主題で作品どうしをつなぐ」ための自由語彙。D1 にも DOM にも触らない純ロジックで、
 * **正規化の規則をここ 1 つに置く** — 付けるとき (API)・引くとき (`/tags/<tag>`)・
 * 入力欄を読むとき (エディタ) で規則がずれると、付けたはずのタグで辿れなくなる。
 */

import { SketchInputError } from "./sketch";

/** 1 タグの上限 (文字数)。長い語は主題ではなく説明文なので、説明欄の仕事。 */
export const TAG_MAX_LENGTH = 30;

/**
 * 1 作品に付けられる数。
 *
 * 絞り込みの助けにならない量を許さないための上限。多く付けるほど一覧に出る機会は
 * 増えるので、放っておくと「全部のタグを付ける」が得になる。
 */
export const TAGS_MAX_COUNT = 5;

/**
 * タグに入れない文字。
 *
 * - 制御文字 (`\p{Cc}`) と書式指定文字 (`\p{Cf}`): 見えないまま値を変える。
 *   right-to-left override のような字は、同じに見えて違うタグを作れてしまう
 * - `,`: 入力欄の区切り (`parseTagInput`)。タグ自身に入ると分解できなくなる
 */
const FORBIDDEN = /[\p{Cc}\p{Cf},]/u;

/**
 * タグ 1 つを正典の形へ。
 *
 * 前後の空白を落とし、内部の空白類は `-` へ畳み、小文字にする。**日本語はそのまま
 * 通る** (`toLowerCase` で変わらない) — ラテン文字だけの語彙に狭めると、この
 * サービスの利用者の半分が主題を書けない。
 *
 * 空白を `-` にするのは、URL に出す値でもあるため。落とすと語の境界が消え
 * (`flow field` → `flowfield`)、そのままにすると `%20` が混ざって読めなくなる。
 */
export function normalizeTag(value: unknown): string {
  if (typeof value !== "string") {
    throw new SketchInputError("タグは文字列で指定してください");
  }

  const collapsed = value.trim().replace(/\s+/gu, "-");
  if (collapsed === "") {
    throw new SketchInputError("空のタグは付けられません");
  }
  if (FORBIDDEN.test(collapsed)) {
    throw new SketchInputError("タグに使えない文字が含まれています");
  }

  const tag = collapsed.toLowerCase();
  // コードポイントで数える。絵文字や結合文字を `length` で数えると、見た目 2 文字の
  // タグが上限に引っかかる。
  if ([...tag].length > TAG_MAX_LENGTH) {
    throw new SketchInputError(
      `タグは ${TAG_MAX_LENGTH} 文字以内にしてください`
    );
  }
  return tag;
}

/**
 * 外から来た配列をタグの並びへ。
 *
 * 重複は**先に出た方を残して**落とす (正規化した結果として同じになるものも同じ扱い)。
 * 個数を数えるのは重複を落とした後 — 同じ語を並べただけで上限に当たるのは、
 * 利用者から見て理由が分からない。
 */
export function parseTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new SketchInputError("タグは配列で指定してください");
  }

  const tags: string[] = [];
  for (const item of value) {
    const tag = normalizeTag(item);
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > TAGS_MAX_COUNT) {
    throw new SketchInputError(`タグは ${TAGS_MAX_COUNT} 個までです`);
  }
  return tags;
}

/**
 * 入力欄 (カンマ区切り) を読む。
 *
 * `a, b,` のような末尾の区切りや、区切りだけの並びは**空として捨てる** — 打ちかけの
 * 形をエラーにすると、まだ書き終えていない人を叱ることになる。中身のある要素の
 * 検査は `parseTags` に任せる。
 */
export function parseTagInput(text: string): string[] {
  return parseTags(text.split(",").filter((part) => part.trim() !== ""));
}

/** タグの並びを入力欄の形へ戻す (`parseTagInput` の逆)。 */
export function formatTagInput(tags: readonly string[]): string {
  return tags.join(", ");
}

/**
 * URL から来た値を正典のタグへ。形が違えば null。
 *
 * `isGitHubLogin` / `isSketchId` と同じ位置づけの関門だが、こちらは**寄せ先も返す** —
 * タグは正規化で変わりうる (`Neon` → `neon`) ので、ページ側は「弾く (404)」と
 * 「正典へ寄せる (302)」を区別する必要がある。
 */
export function canonicalTag(value: string): string | null {
  try {
    return normalizeTag(value);
  } catch {
    return null;
  }
}
