/**
 * ファイル名から MIME を決める。
 *
 * スケッチのファイルは blob URL として配るため、型が合っていないと
 * `<link rel="stylesheet">` や `<script src>` がブラウザに拒否される。
 */

// SVG / HTML は XSS ベクタとして初期除外する方針 (docs/requirements.md 3.3) に合わせ、
// ブラウザが文書として解釈する型は割り当てない。
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  csv: "text/csv",
  txt: "text/plain",
  glsl: "text/plain",
  vert: "text/plain",
  frag: "text/plain",
};

/** 既定。判別できないものはブラウザに解釈させない。 */
const FALLBACK_MIME = "text/plain";

export function mimeForFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return FALLBACK_MIME;
  const extension = name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? FALLBACK_MIME;
}
