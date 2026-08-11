/**
 * ファイル名 → Monaco の言語 ID。
 *
 * スケッチはフォルダの無いフラット構成 (packages/shared の files.ts) なので、
 * 判定材料は拡張子だけで足りる。Monaco が既定で持たない言語 (GLSL など) は
 * plaintext に落とす。ハイライトが無いだけで編集は成立する。
 */

/** 既定で持っていない言語のための落とし所。 */
export const FALLBACK_LANGUAGE = "plaintext";

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  json: "json",
  md: "markdown",
  txt: FALLBACK_LANGUAGE,
};

/**
 * ファイル名に対応する言語 ID を返す。判定できなければ plaintext。
 *
 * 拡張子の大文字小文字は区別しない (`Sketch.JS` も JavaScript)。
 * ドット始まりの名前 (`.gitignore`) は拡張子ではなく本体なので plaintext。
 */
export function resolveLanguage(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return FALLBACK_LANGUAGE;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? FALLBACK_LANGUAGE;
}
