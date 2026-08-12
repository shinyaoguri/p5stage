/**
 * 作品メタデータの検証 (Phase 2-2)。
 *
 * 外から来た JSON をそのまま D1 へ流さないための層。特に見ているのは
 * **公開範囲の既定が `unlisted` であること** — 指定漏れが「公開」に倒れると、
 * 意図しない公開が黙って起きる (要件 3.4)。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TITLE,
  DESCRIPTION_MAX_LENGTH,
  isVisibility,
  normalizeDescription,
  normalizeTitle,
  normalizeVisibility,
  parseSketchInput,
  parseSketchPatch,
  SketchInputError,
  TITLE_MAX_LENGTH,
} from "../src/lib/sketches/sketch";

describe("公開範囲", () => {
  it("既定は限定公開 (指定漏れで公開にしない)", () => {
    expect(normalizeVisibility(undefined)).toBe("unlisted");
    expect(normalizeVisibility(null)).toBe("unlisted");
    expect(parseSketchInput({}).visibility).toBe("unlisted");
  });

  it("公開は明示したときだけ", () => {
    expect(normalizeVisibility("public")).toBe("public");
  });

  it("知らない値は弾く", () => {
    expect(() => normalizeVisibility("private")).toThrow(SketchInputError);
    expect(() => normalizeVisibility(1)).toThrow(SketchInputError);
  });

  it("判定は列挙した値だけを通す", () => {
    expect(isVisibility("public")).toBe(true);
    expect(isVisibility("unlisted")).toBe(true);
    expect(isVisibility("private")).toBe(false);
  });
});

describe("タイトル", () => {
  it("前後の空白を落とす", () => {
    expect(normalizeTitle("  波の習作  ")).toBe("波の習作");
  });

  it("空なら既定の名前になる (名前を付けずに保存できる)", () => {
    expect(normalizeTitle("")).toBe(DEFAULT_TITLE);
    expect(normalizeTitle("   ")).toBe(DEFAULT_TITLE);
    expect(normalizeTitle(undefined)).toBe(DEFAULT_TITLE);
  });

  it("改行は空白に潰す (貼り付けで混ざっても弾かない)", () => {
    expect(normalizeTitle("波の\n習作")).toBe("波の 習作");
    expect(normalizeTitle("波の\t\t習作")).toBe("波の 習作");
  });

  it("長すぎるものは弾く", () => {
    expect(() => normalizeTitle("あ".repeat(TITLE_MAX_LENGTH + 1))).toThrow(
      SketchInputError
    );
    expect(normalizeTitle("あ".repeat(TITLE_MAX_LENGTH))).toHaveLength(
      TITLE_MAX_LENGTH
    );
  });

  it("文字列でなければ弾く", () => {
    expect(() => normalizeTitle(42)).toThrow(SketchInputError);
  });
});

describe("説明", () => {
  it("改行は残す (意味を持つため)", () => {
    expect(normalizeDescription("1 行目\n2 行目")).toBe("1 行目\n2 行目");
  });

  it("前後の空白は落とす", () => {
    expect(normalizeDescription("\n 説明 \n")).toBe("説明");
  });

  it("無ければ空文字", () => {
    expect(normalizeDescription(undefined)).toBe("");
  });

  it("長すぎるものは弾く", () => {
    expect(() =>
      normalizeDescription("あ".repeat(DESCRIPTION_MAX_LENGTH + 1))
    ).toThrow(SketchInputError);
  });
});

describe("parseSketchInput", () => {
  it("整えた値を返す", () => {
    expect(
      parseSketchInput({
        title: " 波の習作 ",
        description: " 説明 ",
        visibility: "public",
      })
    ).toEqual({
      title: "波の習作",
      description: "説明",
      visibility: "public",
    });
  });

  it("オブジェクトでなければ弾く", () => {
    expect(() => parseSketchInput(null)).toThrow(SketchInputError);
    expect(() => parseSketchInput("{}")).toThrow(SketchInputError);
  });
});

describe("parseSketchPatch", () => {
  it("指定された項目だけを返す", () => {
    expect(parseSketchPatch({ title: "新しい題" })).toEqual({
      title: "新しい題",
    });
  });

  it("キーが無い項目は触らない", () => {
    const patch = parseSketchPatch({ visibility: "public" });
    expect(patch.title).toBeUndefined();
    expect(patch.description).toBeUndefined();
  });

  it("null は既定へ戻す指定として扱う", () => {
    // キーが無い (触らない) との区別が要る。
    expect(parseSketchPatch({ description: null })).toEqual({
      description: "",
    });
  });

  it("空の更新は弾く", () => {
    expect(() => parseSketchPatch({})).toThrow(SketchInputError);
    expect(() => parseSketchPatch({ unknown: 1 })).toThrow(SketchInputError);
  });

  it("値が不正なら弾く", () => {
    expect(() => parseSketchPatch({ visibility: "private" })).toThrow(
      SketchInputError
    );
  });
});
