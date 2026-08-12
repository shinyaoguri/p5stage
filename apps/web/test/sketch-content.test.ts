/**
 * 作品ページの URL と中身の並べ方 (Phase 2-4)。
 *
 * URL は「ID が正で login は飾り」という取り決めがそのまま表れる場所なので、
 * **飾りが違ったときに正典へ寄せられるか**を中心に見る (ADR 0011)。
 */

import { describe, expect, it } from "vitest";

import {
  initialFileName,
  isCanonicalLogin,
  orderedFileNames,
  sketchPath,
  sketchPermalink,
} from "../src/lib/sketches/content";

describe("sketchPath", () => {
  it("正典 URL は @login/sketchId", () => {
    expect(sketchPath("shinyaoguri", "AbCdEfGhIjKlMnOp")).toBe(
      "/@shinyaoguri/AbCdEfGhIjKlMnOp"
    );
  });

  it("login に URL の区切りが混ざっても経路をはみ出さない", () => {
    // login は D1 から来る値だが、URL を組み立てる側でも閉じておく。
    expect(sketchPath("a/b", "AbCdEfGhIjKlMnOp")).toBe(
      "/@a%2Fb/AbCdEfGhIjKlMnOp"
    );
  });
});

describe("sketchPermalink", () => {
  it("恒久リンクは login を含まない", () => {
    expect(sketchPermalink("AbCdEfGhIjKlMnOp")).toBe("/s/AbCdEfGhIjKlMnOp");
  });
});

describe("isCanonicalLogin", () => {
  it("持ち主と同じなら正典", () => {
    expect(isCanonicalLogin("shinyaoguri", "shinyaoguri")).toBe(true);
  });

  it("改名前の login は正典ではない (302 して救う)", () => {
    expect(isCanonicalLogin("oldname", "shinyaoguri")).toBe(false);
  });

  it("大文字小文字の違いも正典ではない", () => {
    // GitHub の login は大文字小文字を区別しないので、綴りが同じでも表記が違えば
    // 別 URL になってしまう。正典へ寄せる。
    expect(isCanonicalLogin("ShinyaOguri", "shinyaoguri")).toBe(false);
  });
});

describe("orderedFileNames", () => {
  it("既定の 3 ファイルを決まった順で先に出す", () => {
    expect(
      orderedFileNames({
        "sketch.js": "",
        "style.css": "",
        "index.html": "",
      })
    ).toEqual(["index.html", "style.css", "sketch.js"]);
  });

  it("残りは名前順で後ろに付ける", () => {
    expect(
      orderedFileNames({
        "zebra.js": "",
        "index.html": "",
        "alpha.glsl": "",
      })
    ).toEqual(["index.html", "alpha.glsl", "zebra.js"]);
  });

  it("既定のファイルが欠けていても詰めて並べる", () => {
    expect(orderedFileNames({ "index.html": "", "sketch.js": "" })).toEqual([
      "index.html",
      "sketch.js",
    ]);
  });
});

describe("initialFileName", () => {
  it("最初に開くのは sketch.js (作者が書く場所)", () => {
    expect(
      initialFileName({ "index.html": "", "style.css": "", "sketch.js": "" })
    ).toBe("sketch.js");
  });

  it("sketch.js が無ければ並び順の先頭", () => {
    expect(initialFileName({ "zebra.js": "", "index.html": "" })).toBe(
      "index.html"
    );
  });

  it("ファイルが無ければ null", () => {
    expect(initialFileName({})).toBeNull();
  });
});
