/**
 * 検索語の読み取り (Phase 5)。
 *
 * D1 にも DOM にも触らない純ロジック。入力欄の文字列を **FTS5 の MATCH 式**へ
 * 直すところまでを引き受ける (索引の作りは migrations/0012 / ADR 0020)。
 *
 * ここを 1 か所に置くのは、利用者の打った字がそのまま SQL の式になるため。
 * FTS5 の MATCH は `AND` / `OR` / `NEAR` / `*` / `^` / `:` を構文として読むので、
 * **素通しすると `a OR b` が演算子として効き、`"` 1 つで構文エラーになる**。
 * 語を 1 つずつ引用符で包んでフレーズにするのが、意味も安全も揃う唯一の形。
 */

/**
 * 索引が引ける最短の語長 (コードポイント)。
 *
 * trigram tokenizer は 3 文字の窓で索引を作るので、**2 文字以下の語はどうやっても
 * 引けない** (0 件になる)。ここで足切りするのは D1 を叩かないためというより、
 * 「打ち方が悪かった」と「本当に無い」を利用者に区別させるため。
 */
export const SEARCH_TERM_MIN_LENGTH = 3;

/**
 * 一度に AND する語の数。
 *
 * 語を増やすほど FTS5 が突き合わせるフレーズが増える。5 語も入れて絞れないなら
 * それは検索語ではなく文章で、絞り込みの助けにならない (タグの上限と同じ考え方)。
 */
export const SEARCH_TERMS_MAX_COUNT = 5;

/** 入力欄から受ける長さの上限 (コードポイント)。超えた分は切って読む。 */
export const SEARCH_QUERY_MAX_LENGTH = 100;

/** 検索語の読み取り結果。 */
export type SearchQuery =
  | {
      readonly kind: "ok";
      /** FTS5 に渡す MATCH 式 (引用符で包んだフレーズの並び = 暗黙の AND)。 */
      readonly match: string;
      /** 実際に引く語。画面の説明に出す。 */
      readonly terms: readonly string[];
      /** 短すぎる・数が多すぎるので落とした語。 */
      readonly ignored: readonly string[];
    }
  /** 何も打たれていない (検索前の状態)。 */
  | { readonly kind: "empty" }
  /** 語はあるが、全部が短すぎて引けない。 */
  | { readonly kind: "too-short"; readonly ignored: readonly string[] };

/**
 * 見えない文字。
 *
 * 制御文字 (`\p{Cc}`) と書式指定文字 (`\p{Cf}`) は、タグでは弾いている
 * (`tags.ts`) が、こちらは**空白として読み飛ばす**。検索窓には他所から貼り付けた
 * 文字列が入るもので、目に見えない字が混ざっていたからといって叱る場面ではない。
 *
 * **ZWJ (U+200D) だけは残す。** 絵文字はこれで繋がっているので、空白に変えると
 * 👨‍👩‍👧 のような 1 語が 3 語に割れる。索引の側 (trigram) は文字を並びのまま
 * 見ているので、繋がったまま渡さないと引けない。
 */
const INVISIBLE = /(?!\u200D)[\p{Cc}\p{Cf}]/gu;

/** 語 1 つを FTS5 のフレーズへ。中の `"` は `""` と書いて字に戻す。 */
function toPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

/**
 * 入力欄の文字列を検索語へ。
 *
 * 空白で語に割り、小文字に揃えて重複を落とす。**大小の違いを畳むのは表示のためで、
 * 照合そのものは FTS5 側も大小を無視する** (trigram の既定) — 揃えておくと
 * 「検索した語」として画面に出す値が入力の揺れで変わらない。
 *
 * 落とした語を捨てずに返すのは、0 件だったときに理由を言えるようにするため。
 * 「`3d` は短いので除いた」と言えれば、利用者は打ち直せる。
 */
export function parseSearchQuery(raw: string): SearchQuery {
  // コードポイントで切る。絵文字や結合文字を `length` で切ると字が壊れる。
  const clipped = [...raw.replace(INVISIBLE, " ")]
    .slice(0, SEARCH_QUERY_MAX_LENGTH)
    .join("");

  const words = clipped.split(/\s+/u).filter((word) => word !== "");
  if (words.length === 0) return { kind: "empty" };

  const terms: string[] = [];
  const ignored: string[] = [];
  for (const word of words) {
    const term = word.toLowerCase();
    if (terms.includes(term) || ignored.includes(term)) continue;
    if (
      [...term].length < SEARCH_TERM_MIN_LENGTH ||
      terms.length >= SEARCH_TERMS_MAX_COUNT
    ) {
      ignored.push(term);
      continue;
    }
    terms.push(term);
  }

  if (terms.length === 0) return { kind: "too-short", ignored };
  return { kind: "ok", match: terms.map(toPhrase).join(" "), terms, ignored };
}
