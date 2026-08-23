/**
 * `@types/p5` を Monaco の言語サービスへ渡せる形にして配る Vite プラグイン (Issue #104)。
 *
 * エディタは `virtual:p5-types` を動的 import して、返ってきた各ファイルを
 * `javascriptDefaults.addExtraLib(content, filePath)` へ流す。
 *
 * 設計は ADR 0021。要点は 2 つ。
 *
 * - **1 ファイルへ平坦化しない**。`@types/p5` は `export = p5` と
 *   `declare module './index'` の宣言マージ、`/// <reference path>` で組まれていて、
 *   手で束ねると壊れる。パッケージ内の相対パスをそのまま写して渡し、
 *   TypeScript 自身のモジュール解決に辿らせる
 * - **JSDoc は `global.d.ts` だけ残す**。ホバーの説明文が効くのは
 *   `fill` / `circle` のようなグローバル API で、`src/**` 側の JSDoc は
 *   `p5.Vector` などクラスのメンバに付く。全部残すと 148KB (gzip)、
 *   全部落とすと 17KB、この配分で 73KB
 */

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, relative, sep } from "node:path";

import type { Plugin } from "vite";

/** エディタ側が import する ID。 */
export const P5_TYPES_MODULE_ID = "virtual:p5-types";

/** Rollup の慣習どおり、解決後の ID は `\0` で始めて他のプラグインに触らせない。 */
const RESOLVED_MODULE_ID = `\0${P5_TYPES_MODULE_ID}`;

/** `addExtraLib` に渡す 1 ファイル。 */
export interface P5TypeFile {
  /** `file:///node_modules/@types/p5/...`。相対 import の解決の基点になる。 */
  readonly filePath: string;
  readonly content: string;
}

/**
 * JSDoc を残すファイル。ここだけホバーの説明文が要る。
 *
 * `src/**` を足すと 73KB → 148KB (gzip) になるので、増やすときは大きさも測る。
 */
const KEEP_JSDOC = new Set(["global.d.ts"]);

/**
 * 積まないファイル。
 *
 * `p5.sound` は既定テンプレートが読み込まないアドオンで、単体で 24KB (gzip) ある。
 * `index.html` の script タグを見て後から足す余地は残す (#104)。
 */
const EXCLUDED_DIRECTORIES = new Set(["lib"]);

/** `global.d.ts` 冒頭にある、積まないファイルへの参照。残すと解決できない。 */
const SOUND_REFERENCE =
  /^\/\/\/\s*<reference\s+path="\.\/lib\/addons\/p5\.sound\.d\.ts"\s*\/>\r?\n/m;

/**
 * パッケージ内の相対パスを extraLib の URL にする。
 *
 * `@types/p5` の中は `import p5 = require("./index")` や
 * `/// <reference path="./src/..." />` で互いを指し合う。**この階層をそのまま
 * 写さないと解決できない**ので、URL もパッケージの構成に揃える。
 */
export function extraLibPath(relativePath: string): string {
  return `file:///node_modules/@types/p5/${relativePath.split(sep).join(posix.sep)}`;
}

/**
 * JSDoc (`/** ... *\/`) を落とす。通常のコメント (`//` と `/* *\/`) は残す。
 *
 * 単純な置換ではなく 1 文字ずつ見るのは、文字列リテラルに入った `/**` や `*\/` を
 * コメントの境界と読み違えないため。d.ts には正規表現リテラルが出ないので、
 * 見分けるのは文字列・テンプレート・コメントの 4 種で足りる。
 */
export function stripJsDoc(source: string): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;

    if (char === '"' || char === "'" || char === "`") {
      const end = scanStringEnd(source, index);
      out += source.slice(index, end);
      index = end;
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index);
      const end = newline === -1 ? source.length : newline;
      out += source.slice(index, end);
      index = end;
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      if (source[index + 2] !== "*") {
        out += source.slice(index, end);
        index = end;
        continue;
      }
      // JSDoc。**行ごと消す**。ブロックだけ抜くと、前のインデントと後ろの改行が
      // 残って空行になる。行末で終わっているときだけインデントを削るのは、
      // `/** 略 */ foo` のように後ろに宣言が続く形を潰さないため。
      const afterComment = source[end] === "\r" ? end + 1 : end;
      const endsLine = source[afterComment] === "\n";
      if (endsLine) {
        out = out.replace(/[ \t]*$/, "");
        index = afterComment + 1;
      } else {
        index = end;
      }
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** 文字列・テンプレートリテラルの終端 (閉じ記号の次) を返す。 */
function scanStringEnd(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    // テンプレート以外は行をまたがない。閉じ忘れで残りを丸ごと飲まないようにする。
    if (char === "\n" && quote !== "`") return index;
    index += 1;
  }
  return source.length;
}

/**
 * `@types/p5` のディレクトリから、エディタへ渡す d.ts を集める。
 *
 * 並びは `addExtraLib` の順序に影響しない (TypeScript が参照を辿る) が、
 * 差分を読みやすくするため名前順に固定する。
 */
export function collectP5TypeFiles(packageDirectory: string): P5TypeFile[] {
  const files: P5TypeFile[] = [];

  for (const absolute of listTypeDeclarations(packageDirectory)) {
    const relativePath = relative(packageDirectory, absolute);
    const raw = readFileSync(absolute, "utf8");
    const withoutSound = raw.replace(SOUND_REFERENCE, "");
    files.push({
      filePath: extraLibPath(relativePath),
      content: KEEP_JSDOC.has(relativePath)
        ? withoutSound
        : stripJsDoc(withoutSound),
    });
  }

  return files.sort((a, b) => (a.filePath < b.filePath ? -1 : 1));
}

/** `.d.ts` を再帰的に集める (`lib/` は除く)。 */
function listTypeDeclarations(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      found.push(...listTypeDeclarations(absolute));
      continue;
    }
    if (entry.name.endsWith(".d.ts")) found.push(absolute);
  }
  return found;
}

/** `virtual:p5-types` を提供する。 */
export function p5Types(): Plugin {
  return {
    name: "p5stage:p5-types",
    resolveId(id) {
      return id === P5_TYPES_MODULE_ID ? RESOLVED_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_MODULE_ID) return null;
      const require = createRequire(import.meta.url);
      const packageDirectory = dirname(
        require.resolve("@types/p5/package.json")
      );
      const files = collectP5TypeFiles(packageDirectory);
      return `export default ${JSON.stringify(files)};`;
    },
  };
}
