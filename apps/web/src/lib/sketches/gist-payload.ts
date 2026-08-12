/**
 * Gist へ送る形を組み立てる純ロジック (Phase 2-3)。
 *
 * ネットワークに触る層 (`lib/github/gist.ts`) から「何を送るか」を分けてある。
 * 送る内容の判断 — 消えたファイルをどう伝えるか、Gist が受け付けない値をどこで弾くか —
 * は、応答の解釈より間違えやすく、そのわりに単体で確かめられるため。
 */

import type { SketchFiles } from "@p5stage/shared";

import { DEFAULT_TITLE, TITLE_MAX_LENGTH } from "./sketch";

/** Gist の files パラメータ。null を送ったファイルは Gist から削除される。 */
export type GistFilePayload = Readonly<
  Record<string, { content: string } | null>
>;

/** description に付ける印。付ける側と剥がす側で形がずれないよう 1 か所に置く。 */
const DESCRIPTION_SUFFIX = " — p5stage";

/**
 * Gist の description。
 *
 * 一覧 (gist.github.com) に並ぶのはこの文字列なので、作品名がそのまま読めるようにする。
 * canvastage は「ファイル名のアルファベット順で先頭に来る `_名前.md`」を足して一覧の
 * タイトルを作っていたが、こちらは持ち込まない。**利用者が書いていないファイルが
 * スケッチに混ざる**うえに、作品名は D1 にあって Gist から復元する必要が無い。
 */
export function gistDescription(title: string): string {
  return `${title}${DESCRIPTION_SUFFIX}`;
}

/**
 * description から作品名を復元する (取り込み — Phase 2-6)。
 *
 * 自分が付けた印だけを剥がす。それ以外の description は**そのまま作品名にする** —
 * 他所で作られた Gist に p5stage の書式を期待しても仕方がないし、書いた本人には
 * その文字列が作品名として最も近い。
 *
 * 長すぎる値は弾かずに切る。取り込みは「相手の持ち物を受け入れる」操作なので、
 * 直せる程度のずれで断らない (入力欄から来る値とは扱いが違う)。
 */
export function titleFromDescription(description: string): string {
  const stripped = description.endsWith(DESCRIPTION_SUFFIX)
    ? description.slice(0, -DESCRIPTION_SUFFIX.length)
    : description;

  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (collapsed === "") return DEFAULT_TITLE;
  return collapsed.length > TITLE_MAX_LENGTH
    ? collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()
    : collapsed;
}

/**
 * Gist が受け付けないファイル (中身が空白だけ) の名前。
 *
 * Gist API は中身が空・空白だけのファイルを 422 で拒む。**送ってみて失敗するのではなく
 * 手前で弾く**。失敗すると保存要求そのものが落ちて、他のファイルの変更まで書けなくなる。
 *
 * 空ファイルを黙って落とす手もあるが、それだと「保存したのに次に開くと無い」になる。
 * Gist の制約はスケッチ形式の制約でもある (ADR 0002) ので、理由を見せて断る。
 */
export function unsavableFileNames(files: SketchFiles): string[] {
  return Object.keys(files).filter((name) => (files[name] ?? "").trim() === "");
}

/**
 * 前回の Gist のうち、差分の対象にしてよいファイル名。
 *
 * **中身を読めなかったファイル (1MB 超で truncated) は外す**。エディタはその中身を
 * 受け取っていないので、差分を取ると「消えたファイル」に見えてしまう。触れなければ
 * PATCH はそのまま残すので、外すことが保護になる。
 */
export function replaceableNames(content: {
  readonly files: SketchFiles;
  readonly truncated: readonly string[];
}): string[] {
  return Object.keys(content.files);
}

/**
 * 送るファイルを組み立てる。
 *
 * `previousNames` は Gist に今あるファイル名 (`replaceableNames`)。そこから消えた
 * ものは `null` を送って削除する。PATCH は**送らなかったファイルをそのまま残す**ので、
 * これをやらないとエディタで消したファイルが Gist に残り続け、次に開いたときに甦る。
 */
export function buildGistFiles(
  files: SketchFiles,
  previousNames: readonly string[] = []
): GistFilePayload {
  const payload: Record<string, { content: string } | null> = {};

  for (const name of Object.keys(files)) {
    payload[name] = { content: files[name] ?? "" };
  }
  for (const name of previousNames) {
    if (!(name in payload)) payload[name] = null;
  }

  return payload;
}
