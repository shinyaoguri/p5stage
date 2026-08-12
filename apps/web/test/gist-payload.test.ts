/**
 * Gist へ送る形の組み立て (Phase 2-3)。
 *
 * ここを間違えると、静かに困ったことになる — 消したファイルが Gist に残って次に
 * 開くと甦る、空ファイルで保存要求ごと 422 になって他の変更まで落ちる。
 * どちらも「送るものを決める」段階でしか防げない。
 */

import { describe, expect, it } from "vitest";

import {
  buildGistFiles,
  gistDescription,
  replaceableNames,
  unsavableFileNames,
} from "../src/lib/sketches/gist-payload";

const FILES = { "index.html": "<!doctype html>", "sketch.js": "// hi" };

describe("buildGistFiles", () => {
  it("今あるファイルをそのまま送る", () => {
    expect(buildGistFiles(FILES)).toEqual({
      "index.html": { content: "<!doctype html>" },
      "sketch.js": { content: "// hi" },
    });
  });

  it("消えたファイルは null にして削除を伝える", () => {
    // PATCH は送らなかったファイルを残すので、これが無いと Gist に残骸が残る。
    const payload = buildGistFiles(FILES, [
      "index.html",
      "sketch.js",
      "style.css",
    ]);

    expect(payload["style.css"]).toBeNull();
    expect(payload["sketch.js"]).toEqual({ content: "// hi" });
  });

  it("増えたファイルは削除扱いにしない", () => {
    const payload = buildGistFiles(FILES, ["index.html"]);

    expect(Object.keys(payload).sort()).toEqual(["index.html", "sketch.js"]);
    expect(payload["sketch.js"]).toEqual({ content: "// hi" });
  });
});

describe("replaceableNames", () => {
  it("中身を読めなかったファイルは差分の対象にしない", () => {
    // エディタはその中身を持っていないので、差分を取ると「消えた」ことになり、
    // 次の保存で GitHub 側の大きなファイルを消してしまう。
    const names = replaceableNames({
      files: { "sketch.js": "// hi" },
      truncated: ["big.csv"],
    });

    expect(names).toEqual(["sketch.js"]);
    expect(buildGistFiles({ "sketch.js": "// hi" }, names)).not.toHaveProperty(
      "big.csv"
    );
  });
});

describe("unsavableFileNames", () => {
  it("中身が空白だけのファイルを拾う", () => {
    // Gist API は空・空白だけのファイルを 422 で拒む (ADR 0010)。
    expect(
      unsavableFileNames({ "a.js": "", "b.js": " \n\t", "c.js": "x" })
    ).toEqual(["a.js", "b.js"]);
  });

  it("中身があれば何も拾わない", () => {
    expect(unsavableFileNames(FILES)).toEqual([]);
  });
});

describe("gistDescription", () => {
  it("作品名がそのまま読める", () => {
    // gist.github.com の一覧に並ぶのはこの文字列。
    expect(gistDescription("波紋")).toBe("波紋 — p5stage");
  });
});
