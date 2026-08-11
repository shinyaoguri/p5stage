/**
 * スケッチのファイル構成。
 *
 * 正本が Gist になる (ADR 0002) ため、その制約をそのまま型と検証に持ち込む。
 * フォルダは無いフラット構成で、1 ファイルは 1MB 未満、1 スケッチ 300 ファイルまで
 * (docs/requirements.md 6)。エディタ・ランナー・将来の Gist クライアントが
 * 同じ判断をするよう、検証はここに集約する。
 */

/** ファイル名 → 内容。フォルダは無い。 */
export type SketchFiles = Readonly<Record<string, string>>;

/** 実行の起点。ランナーはこのファイルを HTML として読む。 */
export const ENTRY_FILE = "index.html";

/** 新規スケッチが既定で持つファイル。 */
export const DEFAULT_FILE_NAMES = [ENTRY_FILE, "style.css", "sketch.js"];

/** 1 スケッチのファイル数上限 (Gist の制約)。 */
export const MAX_FILE_COUNT = 300;

/**
 * 1 ファイルのバイト数上限。
 * Gist API は 1MB を超えると truncated を返すため、超える前にサービス側で弾く。
 */
export const MAX_FILE_BYTES = 1_000_000;

/** ファイル名の長さ上限。 */
const MAX_FILE_NAME_LENGTH = 255;

/** 制御文字 (C0 と DEL) を含むか。ファイル名に紛れ込むと表示も比較も壊れる。 */
function hasControlChar(name: string): boolean {
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * ファイル名として使えるか。
 *
 * フラット構成なので区切り文字を含む名前は受け付けない。前後の空白を許すと
 * 「見た目が同じ別ファイル」ができてしまうため、トリム済みであることも求める。
 */
export function isValidFileName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_FILE_NAME_LENGTH) return false;
  if (name !== name.trim()) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (hasControlChar(name)) return false;
  return true;
}

/** 内容のバイト数 (UTF-8)。上限判定は文字数ではなくバイト数で行う。 */
export function fileByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/**
 * ファイル構成を検証し、違反の説明を返す。空配列なら妥当。
 *
 * 例外ではなく一覧を返すのは、エディタが複数の違反をまとめて表示できるようにするため。
 */
export function validateSketchFiles(files: SketchFiles): string[] {
  const errors: string[] = [];
  const names = Object.keys(files);

  if (names.length === 0) {
    errors.push("ファイルが 1 つもありません");
  }
  if (names.length > MAX_FILE_COUNT) {
    errors.push(
      `ファイル数が上限 (${MAX_FILE_COUNT}) を超えています: ${names.length}`
    );
  }
  if (!names.includes(ENTRY_FILE)) {
    errors.push(`${ENTRY_FILE} がありません`);
  }

  for (const name of names) {
    if (!isValidFileName(name)) {
      errors.push(`ファイル名が不正です: ${JSON.stringify(name)}`);
      continue;
    }
    const bytes = fileByteLength(files[name] ?? "");
    if (bytes > MAX_FILE_BYTES) {
      errors.push(
        `${name} が上限 (${MAX_FILE_BYTES} バイト) を超えています: ${bytes} バイト`
      );
    }
  }

  return errors;
}

/**
 * 素性の知れない値をファイル構成として読み取る。妥当でなければ null。
 *
 * postMessage の受信側 (信頼境界) で使うため構造の検証だけを行い、
 * サイズ超過のような「送る側が事前に気付くべき違反」は validateSketchFiles に任せる。
 */
export function parseSketchFiles(value: unknown): SketchFiles | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_FILE_COUNT) return null;

  const files: Record<string, string> = {};
  for (const [name, content] of entries) {
    if (!isValidFileName(name)) return null;
    if (typeof content !== "string") return null;
    files[name] = content;
  }
  return files;
}
