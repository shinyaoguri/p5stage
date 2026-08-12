/**
 * 貼り付けられた Gist の URL / ID の読み取り (Phase 2-6)。
 *
 * ここは取り込みの入口で、**外から来る値に最初に触る場所**。見るのは 2 つ。
 * 実際に人が貼る形 (一覧・リビジョン・raw) から ID を拾えるかと、
 * GitHub 以外の URL を通さないか。
 */

import { describe, expect, it } from "vitest";

import { parseGistRef } from "../src/lib/sketches/gist-ref";

/** 32 桁の 16 進 (今の Gist ID の形)。 */
const ID = "0123456789abcdef0123456789abcdef";

describe("parseGistRef", () => {
  it("ID をそのまま受け取る", () => {
    expect(parseGistRef(ID)).toBe(ID);
    expect(parseGistRef(`  ${ID}  `)).toBe(ID);
  });

  it("作者付きの URL から ID を取る", () => {
    expect(parseGistRef(`https://gist.github.com/someone/${ID}`)).toBe(ID);
  });

  it("作者を含まない URL からも取る", () => {
    expect(parseGistRef(`https://gist.github.com/${ID}`)).toBe(ID);
  });

  it("リビジョン一覧やアンカー付きでも取る", () => {
    expect(
      parseGistRef(`https://gist.github.com/someone/${ID}/revisions`)
    ).toBe(ID);
    expect(
      parseGistRef(`https://gist.github.com/someone/${ID}#file-sketch-js`)
    ).toBe(ID);
  });

  it("raw の URL では ID を取る (リビジョン SHA を掴まない)", () => {
    // sha も 16 進なので、後ろから拾うと別物 (その時点の中身) を指してしまう。
    const sha = "a".repeat(40);
    expect(
      parseGistRef(
        `https://gist.githubusercontent.com/someone/${ID}/raw/${sha}/sketch.js`
      )
    ).toBe(ID);
  });

  it("スキームを省いた貼り付けも受ける", () => {
    expect(parseGistRef(`gist.github.com/someone/${ID}`)).toBe(ID);
  });

  it("API の URL からも取る", () => {
    expect(parseGistRef(`https://api.github.com/gists/${ID}`)).toBe(ID);
  });

  it("GitHub 以外のホストは受け付けない", () => {
    // 16 進が入っているだけの URL で取り込みを始めさせない。
    expect(parseGistRef(`https://example.com/someone/${ID}`)).toBeNull();
    expect(parseGistRef(`https://gist.github.com.evil.test/${ID}`)).toBeNull();
  });

  it("Gist ID の形をしていない値は受け付けない", () => {
    expect(parseGistRef("")).toBeNull();
    expect(parseGistRef("   ")).toBeNull();
    // 16 進以外・短すぎるもの。
    expect(parseGistRef("zzzzzzzzzzzzzzzzzzzz")).toBeNull();
    expect(parseGistRef("abc123")).toBeNull();
    expect(parseGistRef("https://gist.github.com/someone")).toBeNull();
  });
});
