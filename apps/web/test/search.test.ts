/**
 * 検索語の読み取り (Phase 5)。
 *
 * 見ているのは 2 つ。**打った字がそのまま FTS5 の構文にならないこと**と、
 * **引けない語を引く前に見分けられること**。前者を外すと `a OR b` が演算子として
 * 効いたり `"` 1 つで構文エラーになり、後者を外すと 2 文字の語がいつでも
 * 「0 件でした」に化ける (trigram の索引には 3 文字未満が無い)。
 */

import { describe, expect, it } from "vitest";

import { searchPath } from "../src/lib/sketches/content";
import {
  parseSearchQuery,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_TERMS_MAX_COUNT,
  SEARCH_TERM_MIN_LENGTH,
} from "../src/lib/sketches/search";

describe("検索語の読み取り", () => {
  it("語を引用符で包んで MATCH 式にする", () => {
    const query = parseSearchQuery("particle");

    expect(query).toEqual({
      kind: "ok",
      match: '"particle"',
      terms: ["particle"],
      ignored: [],
    });
  });

  it("空白で割った語を並べる (FTS5 では暗黙の AND)", () => {
    const query = parseSearchQuery("  flow   field  ");

    expect(query).toMatchObject({
      kind: "ok",
      match: '"flow" "field"',
      terms: ["flow", "field"],
    });
  });

  it("日本語もそのまま語になる", () => {
    expect(parseSearchQuery("波の実験")).toMatchObject({
      kind: "ok",
      match: '"波の実験"',
    });
  });

  it("大小の違いは畳む", () => {
    expect(parseSearchQuery("Particle")).toMatchObject({
      terms: ["particle"],
    });
  });

  it("同じ語は 1 つにする", () => {
    expect(parseSearchQuery("noise Noise noise")).toMatchObject({
      terms: ["noise"],
      match: '"noise"',
    });
  });

  it("何も打たれていなければ empty", () => {
    expect(parseSearchQuery("")).toEqual({ kind: "empty" });
    expect(parseSearchQuery("   ")).toEqual({ kind: "empty" });
  });
});

describe("引けない語の見分け", () => {
  it(`${SEARCH_TERM_MIN_LENGTH} 文字未満の語は落とし、理由として残す`, () => {
    expect(parseSearchQuery("3d art")).toEqual({
      kind: "ok",
      match: '"art"',
      terms: ["art"],
      ignored: ["3d"],
    });
  });

  it("落とした結果 1 語も残らなければ too-short", () => {
    expect(parseSearchQuery("波 と 光")).toEqual({
      kind: "too-short",
      ignored: ["波", "と", "光"],
    });
  });

  it("日本語も文字数で数える (3 文字なら引ける)", () => {
    expect(parseSearchQuery("波の音")).toMatchObject({ kind: "ok" });
  });

  it("長さはコードポイントで数える", () => {
    // 絵文字 2 つは UTF-16 では 4 単位あるので、`length` で数えると
    // 「3 文字以上」を満たしたことになり、引けない語で D1 を叩く。
    expect(parseSearchQuery("🎨🎵")).toEqual({
      kind: "too-short",
      ignored: ["🎨🎵"],
    });
  });

  it("絵文字を繋ぐ ZWJ は落とさない (語が割れて引けなくなる)", () => {
    expect(parseSearchQuery("👨‍👩‍👧")).toMatchObject({
      kind: "ok",
      terms: ["👨‍👩‍👧"],
    });
  });

  it(`語は ${SEARCH_TERMS_MAX_COUNT} 個まで引き、残りは落とす`, () => {
    const query = parseSearchQuery("aaa bbb ccc ddd eee fff");

    expect(query).toMatchObject({
      kind: "ok",
      terms: ["aaa", "bbb", "ccc", "ddd", "eee"],
      ignored: ["fff"],
    });
  });

  it(`${SEARCH_QUERY_MAX_LENGTH} 文字を超えた分は読まない`, () => {
    const query = parseSearchQuery(
      `${"a".repeat(SEARCH_QUERY_MAX_LENGTH)} zzz`
    );

    expect(query).toMatchObject({
      terms: ["a".repeat(SEARCH_QUERY_MAX_LENGTH)],
      ignored: [],
    });
  });
});

describe("FTS5 の構文を持ち込ませない", () => {
  it("引用符は二重にして字に戻す", () => {
    // `"` を素通しするとフレーズが途中で閉じ、SQL が構文エラーで落ちる。
    expect(parseSearchQuery('a"b"c')).toMatchObject({
      match: '"a""b""c"',
    });
  });

  it("演算子に見える語も 1 つのフレーズとして扱う", () => {
    // 包まないと AND が演算子として効き、字として探しているつもりの人と
    // 結果がずれる (`OR` は 2 文字なので、そもそも語として残らない)。
    expect(parseSearchQuery("cat AND dog")).toMatchObject({
      match: '"cat" "and" "dog"',
    });
  });

  it("前方一致や近傍の記号も字のまま渡す", () => {
    expect(parseSearchQuery("noise* ^head NEAR/2")).toMatchObject({
      match: '"noise*" "^head" "near/2"',
    });
  });

  it("見えない文字は空白として読み飛ばす", () => {
    // 貼り付けた文字列に混ざる書式指定文字。叱らずに語の区切りとして扱う。
    expect(parseSearchQuery("flow​field")).toMatchObject({
      terms: ["flow", "field"],
    });
  });
});

describe("検索結果の URL", () => {
  it("打った字をそのままクエリに載せる", () => {
    expect(searchPath("flow field")).toBe("/search?q=flow%20field");
  });

  it("日本語も percent-encode して載る", () => {
    expect(searchPath("波の音")).toBe(
      `/search?q=${encodeURIComponent("波の音")}`
    );
  });
});
