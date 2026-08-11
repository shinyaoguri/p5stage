import { describe, expect, it } from "vitest";

import {
  MissingEntryFileError,
  buildSketchHtml,
  injectIntoHead,
  normalizeFileRef,
  rewriteFileReferences,
} from "../client/src/build-html";

const urlFor = (name: string) => `blob:https://preview.example/${name}`;
const resolveKnown =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name) ? urlFor(name) : null;

describe("normalizeFileRef", () => {
  it("相対参照をファイル名として読む", () => {
    expect(normalizeFileRef("style.css")).toBe("style.css");
    expect(normalizeFileRef("./style.css")).toBe("style.css");
    expect(normalizeFileRef("  style.css  ")).toBe("style.css");
  });

  it("クエリ・フラグメントを落とす", () => {
    expect(normalizeFileRef("data.json?v=2")).toBe("data.json");
    expect(normalizeFileRef("page.css#top")).toBe("page.css");
  });

  it("外部参照を対象外にする", () => {
    expect(normalizeFileRef("https://cdn.example/p5.js")).toBeNull();
    expect(normalizeFileRef("//cdn.example/p5.js")).toBeNull();
    expect(normalizeFileRef("data:text/css,body{}")).toBeNull();
    expect(normalizeFileRef("blob:https://preview.example/x")).toBeNull();
    expect(normalizeFileRef("/absolute.css")).toBeNull();
    expect(normalizeFileRef("#anchor")).toBeNull();
    expect(normalizeFileRef("")).toBeNull();
  });
});

describe("rewriteFileReferences", () => {
  it("スケッチ内のファイルを指す参照だけを書き換える", () => {
    const html = [
      '<link rel="stylesheet" href="style.css">',
      '<script src="https://cdn.example/p5.js"></script>',
      "<script src='sketch.js'></script>",
    ].join("\n");

    const result = rewriteFileReferences(
      html,
      resolveKnown("style.css", "sketch.js")
    );

    expect(result).toContain(`href="${urlFor("style.css")}"`);
    expect(result).toContain(`src="${urlFor("sketch.js")}"`);
    expect(result).toContain('src="https://cdn.example/p5.js"');
  });

  it("スケッチに無いファイルの参照はそのまま残す", () => {
    const html = '<script src="missing.js"></script>';
    expect(rewriteFileReferences(html, resolveKnown())).toBe(html);
  });

  it("引用符を含む URL が属性を抜け出さない", () => {
    const html = '<link href="style.css">';
    const result = rewriteFileReferences(html, () => 'x" onload="alert(1)');
    expect(result).not.toContain('onload="alert(1)"');
    expect(result).toContain("&quot;");
  });
});

describe("injectIntoHead", () => {
  it("head の直後に差し込む", () => {
    const result = injectIntoHead(
      "<html><head><title>t</title></head></html>",
      "<!--B-->"
    );
    expect(result).toBe("<html><head><!--B--><title>t</title></head></html>");
  });

  it("head が無ければ html の直後に差し込む", () => {
    const result = injectIntoHead(
      '<html lang="ja"><body></body></html>',
      "<!--B-->"
    );
    expect(result).toBe('<html lang="ja"><!--B--><body></body></html>');
  });

  it("html も無ければ先頭に差し込む", () => {
    expect(injectIntoHead("<p>hi</p>", "<!--B-->")).toBe("<!--B--><p>hi</p>");
  });
});

describe("buildSketchHtml", () => {
  const options = {
    headScripts: ["<!--bridge-->"],
    resolveFileUrl: resolveKnown("style.css", "sketch.js"),
  };

  it("ブリッジをユーザーのコードより先に置く", () => {
    const html = buildSketchHtml(
      {
        "index.html":
          '<html><head><script src="https://cdn.example/p5.js"></script></head><body><script src="sketch.js"></script></body></html>',
        "sketch.js": "",
        "style.css": "",
      },
      options
    );

    expect(html.indexOf("<!--bridge-->")).toBeLessThan(
      html.indexOf("https://cdn.example/p5.js")
    );
  });

  it("実行の起点が無ければ組み立てない", () => {
    expect(() => buildSketchHtml({ "sketch.js": "" }, options)).toThrow(
      MissingEntryFileError
    );
  });

  it("参照されていないファイルを勝手に差し込まない", () => {
    const html = buildSketchHtml(
      {
        "index.html": "<html><head></head><body></body></html>",
        "sketch.js": "noop()",
      },
      options
    );

    expect(html).not.toContain("noop()");
    expect(html).not.toContain("sketch.js");
  });
});
