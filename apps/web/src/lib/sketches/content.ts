/**
 * 作品ページ・ユーザーページの URL と、中身の並べ方 (Phase 2-4 / Phase 5)。
 *
 * D1 にも DOM にも触らない純ロジック。
 */

import { DEFAULT_FILE_NAMES, type SketchFiles } from "@p5stage/shared";

/**
 * ユーザーページの正典 URL (Phase 5)。
 *
 * `/@<login>` を組む場所をここ 1 つにして、作品ページの URL
 * (`/@<login>/<id>`) と綴りがずれないようにする。
 */
export function userPath(login: string): string {
  return `/@${encodeURIComponent(login)}`;
}

/**
 * 作品ページの正典 URL。
 *
 * login は**表示のための飾り**で、引く鍵ではない (`users.login` は改名で変わる)。
 * URL の login が今の持ち主と違えばここへ 302 する。Gist は
 * `<username>/<id>` が改名で 404 になるが、こちらはそうならない。
 */
export function sketchPath(ownerLogin: string, sketchId: string): string {
  return `${userPath(ownerLogin)}/${encodeURIComponent(sketchId)}`;
}

/**
 * タグ別一覧の URL (Phase 5)。
 *
 * `/t/` はサムネイル配信が使っているので `/tags/` にする。値は正規化済みの
 * タグ (`normalizeTag`) を渡す前提で、日本語のタグは percent-encoded になる。
 */
export function tagPath(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}`;
}

/**
 * 検索結果の URL (Phase 5)。
 *
 * 検索語はパスではなくクエリに載せる。**打った字はそのまま残す** — タグ
 * (`tagPath`) は正規化した値が正典で、綴りが違えば 302 で寄せるが、検索語には
 * 正典が無く、寄せると「自分が何を打ったか」が画面から消える。
 */
export function searchPath(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
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

/** エディタの URL に作品 ID を載せるときのキー。 */
export const SKETCH_PARAM = "sketch";

/**
 * その作品をエディタで開く URL (#43)。
 *
 * 作品ページから編集へ戻る道はここまで無く、`/edit?sketch=<id>` を手で組み立てる
 * しかなかった。綴りを 2 か所に持たせないよう、エディタ側の読み書き
 * (`scripts/sketch/open-sketch.ts`) も同じキーを使う。
 */
export function editorPath(sketchId: string): string {
  return `/edit?${SKETCH_PARAM}=${encodeURIComponent(sketchId)}`;
}

/**
 * GitHub の login として受け付ける形 (Phase 5)。
 *
 * 英数字とハイフンで 39 文字まで。ハイフンの位置 (先頭・末尾・連続) までは見ない —
 * ここは**外から来た値を D1 へ持って行かないための足切り**で、存在の確認ではない。
 * 規則を厳しく写すほど、歴史的な例外を持つ実在アカウントを弾く事故に近づく。
 */
const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

/** GitHub の login の形か。`isSketchId` / `isGistId` と同じ位置づけの関門。 */
export function isGitHubLogin(value: string): boolean {
  return GITHUB_LOGIN.test(value);
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
