import { describe, expect, it } from "vitest";

import { parseDraft } from "../src/scripts/draft/draft";

const FILES = { "index.html": "<!doctype html>", "sketch.js": "// hi" };

describe("ドラフトの読み取り", () => {
  it("書いたとおりに読み戻せる", () => {
    expect(
      parseDraft({
        files: FILES,
        activeFile: "sketch.js",
        savedAt: 1234,
        sketchId: "AAAAAAAAAAAAAAAA",
        title: "neon-wave-7fq",
      })
    ).toEqual({
      files: FILES,
      activeFile: "sketch.js",
      savedAt: 1234,
      sketchId: "AAAAAAAAAAAAAAAA",
      title: "neon-wave-7fq",
    });
  });

  it("名前が読めなければ「まだ付いていない」として読む", () => {
    // 呼び出し側が自動生成で埋める (#41 の 3)。下書き全体を捨てる理由にはならない。
    expect(parseDraft({ files: FILES })?.title).toBeNull();
    expect(parseDraft({ files: FILES, title: 42 })?.title).toBeNull();
    expect(parseDraft({ files: FILES, title: "   " })?.title).toBeNull();
  });

  it("作品 ID が無ければ「まだ保存していない下書き」として読む", () => {
    // 保存済みの作品の中身として復元されると、開いた作品を別物で上書きしうる。
    expect(parseDraft({ files: FILES, savedAt: 1 })?.sketchId).toBeNull();
    expect(parseDraft({ files: FILES, sketchId: 42 })?.sketchId).toBeNull();
    expect(parseDraft({ files: FILES, sketchId: "" })?.sketchId).toBeNull();
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
