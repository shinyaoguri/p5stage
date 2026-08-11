import { describe, expect, it } from "vitest";

import {
  FALLBACK_LANGUAGE,
  resolveLanguage,
} from "../src/scripts/editor/languages";

describe("resolveLanguage", () => {
  it("既定 3 ファイルをそれぞれの言語に割り当てる", () => {
    expect(resolveLanguage("index.html")).toBe("html");
    expect(resolveLanguage("style.css")).toBe("css");
    expect(resolveLanguage("sketch.js")).toBe("javascript");
  });

  it("拡張子の大文字小文字を区別しない", () => {
    expect(resolveLanguage("Sketch.JS")).toBe("javascript");
  });

  it("最後のドットだけを拡張子とみなす", () => {
    expect(resolveLanguage("data.min.js")).toBe("javascript");
  });

  it("知らない拡張子は plaintext に落とす", () => {
    // GLSL は Monaco が既定で持たない。ハイライトが無いだけで編集はできる。
    expect(resolveLanguage("shader.glsl")).toBe(FALLBACK_LANGUAGE);
    expect(resolveLanguage("data.csv")).toBe(FALLBACK_LANGUAGE);
  });

  it("拡張子が無い名前・ドット始まりの名前も plaintext", () => {
    expect(resolveLanguage("README")).toBe(FALLBACK_LANGUAGE);
    expect(resolveLanguage(".gitignore")).toBe(FALLBACK_LANGUAGE);
    expect(resolveLanguage("")).toBe(FALLBACK_LANGUAGE);
  });

  it("末尾がドットで終わる名前は空の拡張子として plaintext", () => {
    expect(resolveLanguage("sketch.")).toBe(FALLBACK_LANGUAGE);
  });
});
