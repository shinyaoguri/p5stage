/**
 * ファイル操作 (追加・削除・リネーム) の可否判定。
 *
 * タブ UI から切り離して純関数にしてある。判定の理由を日本語のメッセージで返し、
 * 呼び出し側はそれを表示するだけにする。ファイル名そのものの妥当性は
 * `@p5stage/shared` の `fileNameError` が正本で、ここは「いまのファイル構成の中で
 * その操作ができるか」だけを見る。
 */

import { ENTRY_FILE, MAX_FILE_COUNT, fileNameError } from "@p5stage/shared";

/** 新規ファイル名の初期値。拡張子まで入れておくと言語が決まって編集を始めやすい。 */
const NEW_FILE_BASE = "untitled";
const NEW_FILE_EXTENSION = ".js";

/**
 * 削除もリネームもできないファイルか。
 *
 * `index.html` はランナーが読む実行の起点 (packages/shared の files.ts) で、
 * 失われるとスケッチが実行できなくなる。エディタからは消せないようにする。
 */
export function isProtectedFile(name: string): boolean {
  return name === ENTRY_FILE;
}

/** ファイルを追加できるか。できなければ理由を返す。 */
export function checkAddFile(
  name: string,
  existing: readonly string[]
): string | null {
  const error = fileNameError(name);
  if (error !== null) return error;
  if (existing.includes(name)) return `${name} は既にあります`;
  if (existing.length >= MAX_FILE_COUNT) {
    return `ファイル数の上限 (${MAX_FILE_COUNT}) です`;
  }
  return null;
}

/** ファイルの名前を変えられるか。できなければ理由を返す。 */
export function checkRenameFile(
  from: string,
  to: string,
  existing: readonly string[]
): string | null {
  if (!existing.includes(from)) return `${from} がありません`;
  if (isProtectedFile(from)) {
    return `${ENTRY_FILE} は実行の起点なので名前を変えられません`;
  }
  // 名前が変わらないのは操作の取り消しと同じで、失敗として扱う理由が無い。
  if (to === from) return null;
  const error = fileNameError(to);
  if (error !== null) return error;
  if (existing.includes(to)) return `${to} は既にあります`;
  return null;
}

/** ファイルを削除できるか。できなければ理由を返す。 */
export function checkRemoveFile(
  name: string,
  existing: readonly string[]
): string | null {
  if (!existing.includes(name)) return `${name} がありません`;
  if (isProtectedFile(name)) {
    return `${ENTRY_FILE} は実行の起点なので削除できません`;
  }
  return null;
}

/**
 * 削除した後に開くファイル。削除するとファイルが無くなるなら null。
 *
 * 消したタブと同じ位置 (右隣) を開く。末尾を消したときだけ左隣に寄る。
 */
export function nextActiveFile(
  existing: readonly string[],
  removed: string
): string | null {
  const index = existing.indexOf(removed);
  if (index < 0) return null;
  const rest = existing.filter((name) => name !== removed);
  if (rest.length === 0) return null;
  return rest[Math.min(index, rest.length - 1)] ?? null;
}

/** 追加するファイルの名前の初期値。既存と重ならないものを返す。 */
export function suggestFileName(existing: readonly string[]): string {
  const first = `${NEW_FILE_BASE}${NEW_FILE_EXTENSION}`;
  if (!existing.includes(first)) return first;
  // 既存より多く試せば必ず空きが見つかる。
  for (let suffix = 2; suffix <= existing.length + 2; suffix += 1) {
    const candidate = `${NEW_FILE_BASE}-${suffix}${NEW_FILE_EXTENSION}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return first;
}
