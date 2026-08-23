/**
 * `@types/p5` をエディタへ配る前処理 (vite/p5-types.ts) の単体テスト。
 *
 * 実際に補完が出るかは E2E (e2e/completion.spec.ts) が見る。ここで見るのは
 * ブラウザを立てずに確かめられる 2 つ:
 *
 * - JSDoc だけを落として**宣言は 1 文字も変えない**こと
 * - パッケージの構成をそのまま URL に写すこと (相対 import の解決がこれに乗る)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectP5TypeFiles, extraLibPath, stripJsDoc } from "../vite/p5-types";

describe("stripJsDoc", () => {
  it("JSDoc は行ごと消え、宣言のインデントは残る", () => {
    const source = [
      "declare global {",
      "    /**",
      "     *   Draws a circle.",
      "     */",
      "    function circle(x: number, y: number, d: number): void;",
      "}",
      "",
    ].join("\n");

    expect(stripJsDoc(source)).toBe(
      [
        "declare global {",
        "    function circle(x: number, y: number, d: number): void;",
        "}",
        "",
      ].join("\n")
    );
  });

  it("通常のコメントは残す (落とすのは JSDoc だけ)", () => {
    const source = [
      "// This file was auto-generated.",
      "/* eslint-disable */",
      "declare const x: number;",
      "",
    ].join("\n");

    expect(stripJsDoc(source)).toBe(source);
  });

  it("JSDoc を持たないファイルは 1 文字も変わらない", () => {
    const source =
      "import p5 = require('./index');\ndeclare module './index' {}\n";

    expect(stripJsDoc(source)).toBe(source);
  });

  it("文字列リテラルの中の JSDoc 記号はコメントの境界にしない", () => {
    // 単純な置換だと `'/**'` からコメントが始まったことにされ、
    // そこから次の `*/` までが丸ごと消える。
    const source = [
      "type OPEN = '/**';",
      "type CLOSE = '*/';",
      "/** 消える説明 */",
      "declare const y: number;",
      "",
    ].join("\n");

    expect(stripJsDoc(source)).toBe(
      [
        "type OPEN = '/**';",
        "type CLOSE = '*/';",
        "declare const y: number;",
        "",
      ].join("\n")
    );
  });

  it("宣言が同じ行に続く JSDoc はインデントを崩さない", () => {
    const source = "    /** 説明 */ declare const z: number;\n";

    expect(stripJsDoc(source)).toBe("     declare const z: number;\n");
  });
});

describe("extraLibPath", () => {
  it("パッケージ内の相対パスをそのまま URL に写す", () => {
    expect(extraLibPath("global.d.ts")).toBe(
      "file:///node_modules/@types/p5/global.d.ts"
    );
    expect(extraLibPath(join("src", "math", "p5.Vector.d.ts"))).toBe(
      "file:///node_modules/@types/p5/src/math/p5.Vector.d.ts"
    );
  });
});

describe("collectP5TypeFiles", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "p5-types-"));
    mkdirSync(join(directory, "src", "math"), { recursive: true });
    mkdirSync(join(directory, "lib", "addons"), { recursive: true });

    writeFileSync(
      join(directory, "global.d.ts"),
      [
        '/// <reference path="./lib/addons/p5.sound.d.ts" />',
        'import p5 = require("./index");',
        "declare global {",
        "    /**",
        "     *   Sets the fill color.",
        "     */",
        "    function fill(v: number): p5;",
        "}",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(directory, "index.d.ts"),
      ["/**", " *   The p5 class.", " */", "declare class p5 {}", ""].join("\n")
    );
    writeFileSync(
      join(directory, "src", "math", "p5.Vector.d.ts"),
      ["/**", " *   A vector.", " */", "declare class Vector {}", ""].join("\n")
    );
    writeFileSync(
      join(directory, "lib", "addons", "p5.sound.d.ts"),
      "// 重い\n"
    );
    writeFileSync(join(directory, "README.md"), "積まない\n");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("d.ts だけを名前順に集め、lib/ は積まない", () => {
    const files = collectP5TypeFiles(directory);

    expect(files.map((file) => file.filePath)).toEqual([
      "file:///node_modules/@types/p5/global.d.ts",
      "file:///node_modules/@types/p5/index.d.ts",
      "file:///node_modules/@types/p5/src/math/p5.Vector.d.ts",
    ]);
  });

  it("global.d.ts は説明文を残し、積まない p5.sound への参照だけ落とす", () => {
    const global = contentOf(collectP5TypeFiles(directory), "global.d.ts");

    expect(global).not.toContain("p5.sound");
    // ホバーの説明文はここにしか無いので残す。
    expect(global).toContain("Sets the fill color.");
    expect(global).toContain("function fill(v: number): p5;");
  });

  it("global.d.ts 以外は説明文を落とし、宣言は残す", () => {
    const files = collectP5TypeFiles(directory);

    const index = contentOf(files, "index.d.ts");
    expect(index).not.toContain("The p5 class.");
    expect(index).toContain("declare class p5 {}");

    const vector = contentOf(files, "src/math/p5.Vector.d.ts");
    expect(vector).not.toContain("A vector.");
    expect(vector).toContain("declare class Vector {}");
  });
});

function contentOf(
  files: readonly { filePath: string; content: string }[],
  relativePath: string
): string {
  const file = files.find((candidate) =>
    candidate.filePath.endsWith(`/${relativePath}`)
  );
  if (file === undefined) throw new Error(`${relativePath} が集まっていない`);
  return file.content;
}
