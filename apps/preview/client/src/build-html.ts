/**
 * スケッチのファイル構成から、実行用の 1 枚の HTML を組み立てる。
 *
 * 移植元 (canvastage) は `href="style.css"` / `src="sketch.js"` のリテラル一致で
 * 内容をインライン展開していたが、任意のファイル名を扱えず、内容に `</script>` が
 * 含まれると壊れる。p5stage は参照を blob URL へ**書き換える**方式にして、
 * エスケープ問題ごと無くす (ADR 0007)。
 *
 * この層は DOM に触れない純粋な文字列処理にしてある (テストしやすさのため)。
 */

import { ENTRY_FILE, type SketchFiles } from "@p5stage/shared";

/** 実行の起点が無いときに投げる。ランナーはこれを捕まえてコンソールへ出す。 */
export class MissingEntryFileError extends Error {
  constructor() {
    super(`${ENTRY_FILE} がありません`);
    this.name = "MissingEntryFileError";
  }
}

export interface BuildSketchHtmlOptions {
  /** `<head>` の直後へ差し込む完全な `<script>` タグ。ユーザーのコードより先に走る。 */
  readonly headScripts: readonly string[];
  /** ファイル名 → 実行時 URL。null を返した参照は書き換えない。 */
  resolveFileUrl(name: string): string | null;
}

const REFERENCE_ATTRIBUTE = /\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const HEAD_OPEN_TAG = /<head\b[^>]*>/i;
const HTML_OPEN_TAG = /<html\b[^>]*>/i;

/**
 * HTML の参照 (`href` / `src`) をスケッチ内のファイル名として読み取る。
 * 外部 URL・絶対パス・フラグメントは対象外なので null を返す。
 */
export function normalizeFileRef(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  // scheme 付き (http:, data:, blob:, //) と絶対パスは外部参照。
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (value.startsWith("//") || value.startsWith("/")) return null;
  if (value.startsWith("#")) return null;

  const [withoutQuery = ""] = value.split(/[?#]/);
  const name = withoutQuery.replace(/^\.\//, "");
  return name === "" ? null : name;
}

/** 属性値として安全な形にする。blob URL に引用符は出ないが、念のため落とす。 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** スケッチ内のファイルを指す参照だけを、与えられた URL へ書き換える。 */
export function rewriteFileReferences(
  html: string,
  resolveFileUrl: (name: string) => string | null
): string {
  return html.replace(
    REFERENCE_ATTRIBUTE,
    (
      match,
      attribute: string,
      doubleQuoted?: string,
      singleQuoted?: string
    ) => {
      const raw = doubleQuoted ?? singleQuoted ?? "";
      const name = normalizeFileRef(raw);
      if (name === null) return match;

      const url = resolveFileUrl(name);
      if (url === null) return match;

      return `${attribute}="${escapeAttribute(url)}"`;
    }
  );
}

/**
 * `<head>` の直後へ差し込む。`<head>` が無ければ `<html>` の直後、
 * それも無ければ先頭に置く (ユーザーが自由に書ける HTML なので、必ず場所を見つける)。
 */
export function injectIntoHead(html: string, snippet: string): string {
  const head = HEAD_OPEN_TAG.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }

  const htmlTag = HTML_OPEN_TAG.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }

  return snippet + html;
}

/**
 * 実行用 HTML を組み立てる。
 *
 * 移植元にあった「プレースホルダが消えていたら CSS / JS を末尾へ足す」保険は入れない。
 * マルチファイルでは「参照されないファイル」が普通にあり (loadJSON で読むだけの data.json 等)、
 * 保険と正常なファイルを区別できないため。index.html の保護はエディタ側の責務にする。
 */
export function buildSketchHtml(
  files: SketchFiles,
  options: BuildSketchHtmlOptions
): string {
  const entry = files[ENTRY_FILE];
  if (entry === undefined) throw new MissingEntryFileError();

  const rewritten = rewriteFileReferences(entry, options.resolveFileUrl);
  return injectIntoHead(rewritten, options.headScripts.join("\n"));
}
