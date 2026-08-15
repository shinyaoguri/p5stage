/**
 * タグの正規化 (Phase 5)。
 *
 * 見ているのは**同じ主題が同じタグに落ちること**。付けるとき (API)・引くとき
 * (`/tags/<tag>`)・入力欄を読むとき (エディタ) が同じ規則を通るので、ここがずれると
 * 「付けたはずのタグで辿れない」が起きる。
 */

import { describe, expect, it } from "vitest";

import { tagPath } from "../src/lib/sketches/content";
import { SketchInputError } from "../src/lib/sketches/sketch";
import {
  canonicalTag,
  formatTagInput,
  normalizeTag,
  parseTagInput,
  parseTags,
  TAGS_MAX_COUNT,
  TAG_MAX_LENGTH,
} from "../src/lib/sketches/tags";

describe("タグ 1 つの正規化", () => {
  it("前後の空白を落とし、小文字に揃える", () => {
    expect(normalizeTag("  Generative  ")).toBe("generative");
  });

  it("語の間の空白は - に畳む (URL に出る値なので落とさない)", () => {
    expect(normalizeTag("flow field")).toBe("flow-field");
    expect(normalizeTag("flow \t field")).toBe("flow-field");
  });

  it("日本語はそのまま通る", () => {
    expect(normalizeTag(" 実験 ")).toBe("実験");
  });

  it("空・空白だけは弾く", () => {
    expect(() => normalizeTag("")).toThrow(SketchInputError);
    expect(() => normalizeTag("   ")).toThrow(SketchInputError);
  });

  it("文字列でなければ弾く", () => {
    expect(() => normalizeTag(3)).toThrow(SketchInputError);
    expect(() => normalizeTag(null)).toThrow(SketchInputError);
  });

  it("見えない字を混ぜたタグは弾く (同じに見えて違うタグを作らせない)", () => {
    // ゼロ幅スペースと right-to-left override。エスケープで書くのは、ソースに直に
    // 置くと読む側に見えず、テストが何を確かめているのか分からなくなるため。
    expect(() => normalizeTag("ne\u200bon")).toThrow(SketchInputError);
    expect(() => normalizeTag("ne\u202eon")).toThrow(SketchInputError);
  });

  it("区切りに使うカンマは入れられない", () => {
    expect(() => normalizeTag("a,b")).toThrow(SketchInputError);
  });

  it("上限ちょうどは通り、超えると弾く", () => {
    expect(normalizeTag("a".repeat(TAG_MAX_LENGTH))).toHaveLength(
      TAG_MAX_LENGTH
    );
    expect(() => normalizeTag("a".repeat(TAG_MAX_LENGTH + 1))).toThrow(
      SketchInputError
    );
  });

  it("長さはコードポイントで数える (絵文字を 2 文字と数えない)", () => {
    // サロゲートペアの絵文字。`length` で数えると上限の 2 倍を消費する。
    expect(normalizeTag("🎨".repeat(TAG_MAX_LENGTH))).toBeTypeOf("string");
  });
});

describe("タグの並び", () => {
  it("正規化した結果が同じものは 1 つに畳む (先に出た方を残す)", () => {
    expect(parseTags(["Neon", "neon", "NEON"])).toEqual(["neon"]);
  });

  it("並べた順は保つ", () => {
    expect(parseTags(["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("指定が無ければ空", () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(null)).toEqual([]);
  });

  it("配列でなければ弾く", () => {
    expect(() => parseTags("a,b")).toThrow(SketchInputError);
  });

  it("上限ちょうどは通り、超えると弾く", () => {
    const many = Array.from({ length: TAGS_MAX_COUNT }, (_, i) => `t${i}`);
    expect(parseTags(many)).toHaveLength(TAGS_MAX_COUNT);
    expect(() => parseTags([...many, "over"])).toThrow(SketchInputError);
  });

  it("重複を数に含めない (同じ語を並べただけで上限に当てない)", () => {
    const repeated = Array.from({ length: TAGS_MAX_COUNT + 2 }, () => "same");
    expect(parseTags(repeated)).toEqual(["same"]);
  });
});

describe("入力欄の読み書き", () => {
  it("カンマで分け、前後の空白は落とす", () => {
    expect(parseTagInput("generative, 3D , 実験")).toEqual([
      "generative",
      "3d",
      "実験",
    ]);
  });

  it("打ちかけの区切りは空として捨てる", () => {
    expect(parseTagInput("neon, ")).toEqual(["neon"]);
    expect(parseTagInput(" , , ")).toEqual([]);
    expect(parseTagInput("")).toEqual([]);
  });

  it("書き戻した文字列は読み直すと同じ並びになる", () => {
    const tags = ["neon", "flow-field", "実験"];
    expect(parseTagInput(formatTagInput(tags))).toEqual(tags);
  });
});

describe("URL の値", () => {
  it("正典の形はそのまま返る", () => {
    expect(canonicalTag("neon")).toBe("neon");
  });

  it("寄せ先がある値は寄せ先を返す (ページは 302 に使う)", () => {
    expect(canonicalTag("Neon")).toBe("neon");
    expect(canonicalTag("flow field")).toBe("flow-field");
  });

  it("形が違う値は null (ページは 404 に使う)", () => {
    expect(canonicalTag("")).toBeNull();
    expect(canonicalTag("a".repeat(TAG_MAX_LENGTH + 1))).toBeNull();
    expect(canonicalTag("a,b")).toBeNull();
  });

  it("パスは percent-encode する (日本語のタグも URL に載る)", () => {
    expect(tagPath("neon")).toBe("/tags/neon");
    expect(tagPath("実験")).toBe(`/tags/${encodeURIComponent("実験")}`);
  });
});
