/**
 * Monaco が**ソースへインライン同梱している** DOMPurify を、npm の `dompurify` へ
 * 解決し直す Vite プラグイン (Issue #111 / ADR 0024)。
 *
 * `monaco-editor` は `package.json` に `dompurify` を宣言しているが、配布物の中で
 * それを import する箇所は無い。実体は
 * `esm/vs/base/browser/dompurify/dompurify.js` に焼き込まれていて、
 * `esm/vs/base/browser/domSanitize.js` が相対パスで読む。
 *
 * したがって **`overrides` で npm 側を上げてもブラウザへ届くコードは変わらない**。
 * ここで import を差し替えて初めて、配信物の DOMPurify が実際に入れ替わる。
 *
 * 差し替えが空振りしたら気付けるように 2 段のガードを置く。
 *
 * - 同梱版がバンドルへ入ったら `transform` で即座に落とす
 * - `domSanitize.js` は通ったのに差し替えが 0 回なら `buildEnd` で落とす
 *   (import の書き方が変わった形)
 *
 * `domSanitize.js` 自体が別名になる形は静的には見えないので、
 * apps/web/test/monaco-dompurify.test.ts が node_modules を走査して受け持つ。
 */

import type { Plugin } from "vite";

/** `domSanitize.js` が同梱版を読むときの相対指定。 */
export const VENDORED_SPECIFIER = "./dompurify/dompurify.js";

/** 同梱版を import している唯一のファイル (パッケージ内の相対パス)。 */
export const VENDORED_IMPORTER = "esm/vs/base/browser/domSanitize.js";

/** 同梱版そのもの (パッケージ内の相対パス)。 */
export const VENDORED_MODULE = "esm/vs/base/browser/dompurify/dompurify.js";

/** Windows の区切りを均して、末尾一致で見分けられる形にする。 */
function toPosix(id: string): string {
  return id.split("\\").join("/");
}

/** `monaco-editor` パッケージ内の相対パスで終わる ID か。 */
function isMonacoFile(id: string, relativePath: string): boolean {
  return toPosix(id).endsWith(`monaco-editor/${relativePath}`);
}

/** Monaco の同梱 DOMPurify を npm の `dompurify` へ向け直す。 */
export function monacoDompurify(): Plugin {
  let replacements = 0;
  let sawImporter = false;

  return {
    name: "p5stage:monaco-dompurify",
    // vite:resolve より先に見る。後回しにすると同梱版が解決されてしまう。
    enforce: "pre",

    async resolveId(source, importer) {
      if (source !== VENDORED_SPECIFIER) return null;
      if (!importer || !isMonacoFile(importer, VENDORED_IMPORTER)) return null;

      // 解決は Vite に任せる。`exports` の `import` 条件を辿って
      // `dist/purify.es.mjs` (default export が DOMPurify インスタンス) に届く。
      const resolved = await this.resolve("dompurify", importer, {
        skipSelf: true,
      });
      if (!resolved) {
        throw new Error(
          "monaco-dompurify: npm の dompurify を解決できなかった。" +
            "apps/web の依存に dompurify が入っているか確かめる (ADR 0024)。"
        );
      }

      replacements += 1;
      return resolved.id;
    },

    transform(_code, id) {
      if (isMonacoFile(id, VENDORED_IMPORTER)) sawImporter = true;
      if (isMonacoFile(id, VENDORED_MODULE)) {
        throw new Error(
          `monaco-dompurify: 同梱版 (${VENDORED_MODULE}) がバンドルに入った。` +
            "差し替えの網から漏れた import がある (ADR 0024)。"
        );
      }
      return null;
    },

    buildEnd() {
      if (sawImporter && replacements === 0) {
        throw new Error(
          `monaco-dompurify: ${VENDORED_IMPORTER} は通ったのに差し替えが 0 回だった。` +
            "Monaco 側の import の書き方が変わっている (ADR 0024)。"
        );
      }
    },
  };
}
