/**
 * 作品ページの URL と、中身の並べ方 (Phase 2-4)。
 *
 * D1 にも DOM にも触らない純ロジック。
 */

import { DEFAULT_FILE_NAMES, type SketchFiles } from "@p5stage/shared";

/**
 * 作品ページの正典 URL。
 *
 * login は**表示のための飾り**で、引く鍵ではない (`users.login` は改名で変わる)。
 * URL の login が今の持ち主と違えばここへ 302 する。Gist は
 * `<username>/<id>` が改名で 404 になるが、こちらはそうならない。
 */
export function sketchPath(ownerLogin: string, sketchId: string): string {
  return `/@${encodeURIComponent(ownerLogin)}/${encodeURIComponent(sketchId)}`;
}

/**
 * login に依存しない恒久リンク。常に正典 URL へ 302 する。
 *
 * 「持ち主が改名しても確実に生きている URL」が要る場面 (外部に貼る・引用する) 用。
 */
export function sketchPermalink(sketchId: string): string {
  return `/s/${encodeURIComponent(sketchId)}`;
}

/**
 * 過去の版の URL (Phase 4-1)。
 *
 * 正典 URL にクエリを足すだけにしてある。**パスを分けない**のは、`<link rel="canonical">`
 * がクエリの無い URL を指し続ける形にしたいため (公開作品の版は増え続けるので、
 * 検索エンジンに近似重複を大量に見せない — ADR 0016)。
 */
export function sketchRevisionPath(
  ownerLogin: string,
  sketchId: string,
  revision: string
): string {
  return `${sketchPath(ownerLogin, sketchId)}?rev=${encodeURIComponent(revision)}`;
}

/**
 * URL の login が正典どおりか。
 *
 * GitHub の login は大文字小文字を区別しないので、綴りが同じでも表記が違えば
 * 正典へ寄せる。同じ作品に複数の URL が生まれるのを避ける。
 */
export function isCanonicalLogin(
  urlLogin: string,
  ownerLogin: string
): boolean {
  return urlLogin === ownerLogin;
}

/**
 * 閲覧画面に並べる順。
 *
 * 既定の 3 ファイル (index.html / style.css / sketch.js) を先に、残りを名前順で。
 * Gist から返る順にも保存した順にも意味は無いので、**どの作品でも同じ場所に
 * 同じものがある**方が読み手の負担が小さい。
 */
export function orderedFileNames(files: SketchFiles): string[] {
  const names = Object.keys(files);
  const defaults = DEFAULT_FILE_NAMES.filter((name) => names.includes(name));
  const rest = names
    .filter((name) => !DEFAULT_FILE_NAMES.includes(name))
    .sort((a, b) => a.localeCompare(b));
  return [...defaults, ...rest];
}

/** 閲覧画面が最初に開くファイル。作者が書く場所であることが多い。 */
export function initialFileName(files: SketchFiles): string | null {
  const ordered = orderedFileNames(files);
  if (ordered.includes("sketch.js")) return "sketch.js";
  return ordered[0] ?? null;
}
