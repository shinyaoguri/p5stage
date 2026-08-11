import { describe, expect, it } from "vitest";

import { parseDraft } from "../src/scripts/draft/draft";

const FILES = { "index.html": "<!doctype html>", "sketch.js": "// hi" };

describe("ドラフトの読み取り", () => {
  it("書いたとおりに読み戻せる", () => {
    expect(
      parseDraft({ files: FILES, activeFile: "sketch.js", savedAt: 1234 })
    ).toEqual({ files: FILES, activeFile: "sketch.js", savedAt: 1234 });
  });

  it("ファイル構成が読めないものは捨てる", () => {
    // 中身は倒しようがないので、ここだけは全体を捨てて既定で始める。
    expect(parseDraft(undefined)).toBeNull();
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("draft")).toBeNull();
    expect(parseDraft([FILES])).toBeNull();
    expect(parseDraft({})).toBeNull();
    expect(parseDraft({ files: {} })).toBeNull();
    expect(parseDraft({ files: { "sketch.js": 1 } })).toBeNull();
    expect(parseDraft({ files: { "dir/sketch.js": "" } })).toBeNull();
  });

  it("開いていたファイルが消えていたら先頭のファイルへ倒す", () => {
    // 別タブで消した・手で書き換えた場合。下書き全体を捨てる理由にはならない。
    const draft = parseDraft({ files: FILES, activeFile: "gone.js" });
    expect(draft?.activeFile).toBe("index.html");
    expect(draft?.files).toEqual(FILES);
  });

  it("時刻が読めなければ 0 として扱う", () => {
    expect(parseDraft({ files: FILES, savedAt: "きのう" })?.savedAt).toBe(0);
    expect(parseDraft({ files: FILES, savedAt: NaN })?.savedAt).toBe(0);
  });

  it("上限を超える大きさでも捨てない", () => {
    // 1MB は Gist の制約 (Phase 2)。手元の下書きを消す理由にはならない。
    const huge = { "index.html": "a".repeat(1_000_001) };
    expect(
      parseDraft({ files: huge, activeFile: "index.html" })
    ).not.toBeNull();
  });
});
