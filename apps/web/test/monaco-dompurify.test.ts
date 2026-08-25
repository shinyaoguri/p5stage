/**
 * Monaco の同梱 DOMPurify を差し替える前提 (vite/monaco-dompurify.ts) が
 * まだ成り立っているかを見る (Issue #111 / ADR 0024)。
 *
 * 差し替えそのものはビルド時のガードが見る (同梱版がバンドルへ入ったら落ちる)。
 * ここで見るのは、**ビルドを走らせても気付けない 2 つ**。
 *
 * - 同梱版を読む口が増えていないか。増えた口は差し替えの網から漏れる
 * - 差し替えが downgrade になっていないか。Monaco が pin を上げたのに
 *   こちらの npm 版が古いままだと、差し替えるほど古くなる
 *
 * 実ブラウザでサニタイズが効いているかは e2e/sanitize.spec.ts が見る。
 */

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  VENDORED_IMPORTER,
  VENDORED_MODULE,
  VENDORED_SPECIFIER,
} from "../vite/monaco-dompurify";

const require = createRequire(import.meta.url);

/**
 * パッケージの根を割り出す。
 *
 * `monaco-editor` も `dompurify` も `exports` に `./package.json` を載せて
 * いないので、`require.resolve("<名前>/package.json")` は使えない。
 * 実体のパスから名前の区切りを探して遡る。
 */
function packageRoot(name: string): string {
  const entry = require.resolve(name);
  const marker = `${sep}${name}${sep}`;
  const index = entry.lastIndexOf(marker);
  if (index === -1) throw new Error(`${name} の位置を割り出せない: ${entry}`);
  return entry.slice(0, index + marker.length - 1);
}

const monacoDirectory = packageRoot("monaco-editor");

/** 同梱版の冒頭にあるライセンス表記。ここにしか版が書かれていない。 */
const VENDORED_LICENSE = /@license DOMPurify (\d+\.\d+\.\d+)/;

/** `1.2.3` を比較できる数値の並びにする。 */
function parseVersion(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

/** `a` が `b` 以上か。 */
function isAtLeast(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/** ディレクトリ配下の `.js` を再帰的に集める。 */
function listScripts(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...listScripts(absolute));
      continue;
    }
    if (entry.name.endsWith(".js")) found.push(absolute);
  }
  return found;
}

describe("Monaco の同梱 DOMPurify", () => {
  it("同梱版を読むのは domSanitize.js 1 本だけ", () => {
    const esmDirectory = join(monacoDirectory, "esm");
    const importers = listScripts(esmDirectory)
      .filter((absolute) => {
        // 同梱版そのものは除く (自分自身を指す表記は無いが、名前で引っかかる)。
        const relativePath = relative(monacoDirectory, absolute)
          .split(sep)
          .join("/");
        if (relativePath === VENDORED_MODULE) return false;
        return readFileSync(absolute, "utf8").includes(VENDORED_SPECIFIER);
      })
      .map((absolute) =>
        relative(monacoDirectory, absolute).split(sep).join("/")
      );

    // 増えていたら vite/monaco-dompurify.ts の差し替え条件を広げる。
    expect(importers).toEqual([VENDORED_IMPORTER]);
  });

  it("差し替え先の npm 版が同梱版より古くない", () => {
    const vendored = readFileSync(
      join(monacoDirectory, VENDORED_MODULE),
      "utf8"
    ).slice(0, 200);
    const matched = VENDORED_LICENSE.exec(vendored);
    // 表記が消えたら版を確かめる術が無くなる。気付けるように落とす。
    expect(matched).not.toBeNull();

    const installed = JSON.parse(
      readFileSync(join(packageRoot("dompurify"), "package.json"), "utf8")
    ) as { version: string };

    // 逆転していたら、Monaco が pin を上げたのにこちらが追えていない。
    // apps/web の dompurify とルートの overrides を上げる (差し替えが要らなく
    // なっていれば、プラグインごと畳んでよい)。
    expect(
      isAtLeast(installed.version, (matched as RegExpExecArray)[1] as string)
    ).toBe(true);
  });
});
