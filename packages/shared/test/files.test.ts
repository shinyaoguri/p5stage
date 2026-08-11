import { describe, expect, it } from "vitest";

import {
  ENTRY_FILE,
  MAX_FILE_BYTES,
  MAX_FILE_COUNT,
  isValidFileName,
  parseSketchFiles,
  validateSketchFiles,
} from "../src/files";

describe("isValidFileName", () => {
  it("通常のファイル名を許す", () => {
    expect(isValidFileName("sketch.js")).toBe(true);
    expect(isValidFileName("データ.json")).toBe(true);
    expect(isValidFileName(".eslintrc")).toBe(true);
  });

  it("フォルダを表す区切りを許さない (Gist はフラット構成)", () => {
    expect(isValidFileName("lib/util.js")).toBe(false);
    expect(isValidFileName("lib\\util.js")).toBe(false);
  });

  it("空・空白のみ・前後に空白のある名前を許さない", () => {
    expect(isValidFileName("")).toBe(false);
    expect(isValidFileName("   ")).toBe(false);
    expect(isValidFileName(" sketch.js")).toBe(false);
    expect(isValidFileName("sketch.js ")).toBe(false);
  });

  it("相対パスを表す名前を許さない", () => {
    expect(isValidFileName(".")).toBe(false);
    expect(isValidFileName("..")).toBe(false);
  });

  it("制御文字を含む名前を許さない", () => {
    expect(isValidFileName(`a${String.fromCharCode(0)}b.js`)).toBe(false);
    expect(isValidFileName(`a${String.fromCharCode(10)}b.js`)).toBe(false);
    expect(isValidFileName(`a${String.fromCharCode(0x7f)}b.js`)).toBe(false);
  });

  it("長すぎる名前を許さない", () => {
    expect(isValidFileName("a".repeat(255))).toBe(true);
    expect(isValidFileName("a".repeat(256))).toBe(false);
  });
});

describe("validateSketchFiles", () => {
  it("既定の構成は妥当", () => {
    expect(
      validateSketchFiles({ [ENTRY_FILE]: "<html></html>", "sketch.js": "" })
    ).toEqual([]);
  });

  it("実行の起点が無いことを指摘する", () => {
    const errors = validateSketchFiles({ "sketch.js": "" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(ENTRY_FILE);
  });

  it("空の構成を指摘する", () => {
    expect(validateSketchFiles({}).length).toBeGreaterThan(0);
  });

  it("バイト数の上限で判定する (文字数ではなく)", () => {
    // 3 バイト文字なので、文字数では上限内でもバイト数では超える。
    const overSized = "あ".repeat(Math.ceil(MAX_FILE_BYTES / 3));
    const errors = validateSketchFiles({
      [ENTRY_FILE]: "",
      "big.txt": overSized,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("big.txt");
  });

  it("ファイル数の上限を超えたら指摘する", () => {
    const files: Record<string, string> = { [ENTRY_FILE]: "" };
    for (let i = 0; i <= MAX_FILE_COUNT; i += 1) files[`f${i}.txt`] = "";
    expect(
      validateSketchFiles(files).some((e) => e.includes("ファイル数"))
    ).toBe(true);
  });

  it("不正な名前を指摘し、その内容のサイズ判定は行わない", () => {
    const errors = validateSketchFiles({ [ENTRY_FILE]: "", "a/b.js": "" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ファイル名");
  });
});

describe("parseSketchFiles", () => {
  it("ファイル名 → 内容のオブジェクトを受け付ける", () => {
    expect(parseSketchFiles({ "sketch.js": "noop()" })).toEqual({
      "sketch.js": "noop()",
    });
  });

  it("オブジェクト以外を拒む", () => {
    expect(parseSketchFiles(null)).toBeNull();
    expect(parseSketchFiles("sketch.js")).toBeNull();
    expect(parseSketchFiles(["sketch.js"])).toBeNull();
    expect(parseSketchFiles({})).toBeNull();
  });

  it("内容が文字列でないものを拒む", () => {
    expect(parseSketchFiles({ "sketch.js": 1 })).toBeNull();
    expect(parseSketchFiles({ "sketch.js": null })).toBeNull();
  });

  it("不正なファイル名を含むものを丸ごと拒む (信頼境界なので部分採用しない)", () => {
    expect(parseSketchFiles({ "ok.js": "", "../evil.js": "" })).toBeNull();
  });

  it("ファイル数の上限を超えるものを拒む", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_FILE_COUNT; i += 1) files[`f${i}.txt`] = "";
    expect(parseSketchFiles(files)).toBeNull();
  });
});
