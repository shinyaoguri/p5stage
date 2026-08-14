/**
 * assets.json — 作品が使うアセットの一覧 (ADR 0003)。
 *
 * 実体は R2 の不変 blob だが、**どのファイル名がどの blob か**を持つのはこのファイルで、
 * 置き場は正本の Gist の中 (ADR 0002)。マニフェストが Gist のリビジョンに入るので、
 * リビジョン = コード + アセットの完全なスナップショットになり、過去のリビジョンは
 * 当時のアセットで再現される。
 *
 * 読む側が 3 つある — 保存を受ける本体・アセットを並べるエディタ (3-4)・名前を URL へ
 * 解決するランナー (3-3)。**同じ JSON を違う解釈で読むと作品が壊れる**ので、
 * 形と検証はここに 1 つだけ置く。
 *
 * 検証を手書きにしてあるのは、ADR 0003 が挙げていた zod を入れるより、
 * `fileNameError` と同じ「なぜ駄目かをそのまま利用者に見せる」形に揃える方が
 * この規模では読みやすいため (ADR 0003 の補足に根拠を残した)。
 */

import { isAssetMime, isSha256Hex, type AssetMime } from "./assets";
import { fileNameError, type SketchFiles } from "./files";

/**
 * マニフェストのファイル名。**予約名**として扱う。
 *
 * 利用者が同じ名前のデータファイルを持ち込むことはあり得るが、その場合は
 * 名前を変えてもらう。中身の形で「マニフェストか利用者のデータか」を推測すると、
 * 壊れたマニフェストを黙って利用者のデータと解釈して、アセットが理由も無く
 * 消えたように見える。
 */
export const ASSET_MANIFEST_FILE = "assets.json";

/**
 * マニフェストの形式。
 *
 * 利用者の Gist に残り続けるファイルなので、後から形を変えられる余地を最初から持つ。
 * 知らない版を**読めるふりをしない**ための番号でもある。
 */
export const ASSET_MANIFEST_VERSION = 1;

/** アセット 1 つ。ファイル名から引く。 */
export interface AssetEntry {
  /** 実体の sha256 (小文字 16 進)。R2 のキーでもある。 */
  readonly sha256: string;
  readonly size: number;
  /**
   * 配信するときの Content-Type。
   *
   * **アップロード時に中身から決まった値**で、ファイル名の拡張子とは独立している
   * (.png に名前を変えた jpeg は jpeg として配る方が正しい)。
   */
  readonly mime: AssetMime;
}

/** assets.json の中身。 */
export interface AssetManifest {
  readonly version: typeof ASSET_MANIFEST_VERSION;
  /** ファイル名 → 実体。コード側は `loadImage("cat.png")` のようにこの名前で参照する。 */
  readonly assets: Readonly<Record<string, AssetEntry>>;
}

/**
 * 読み取りの結果。
 *
 * 例外ではなく理由を返す。マニフェストは**利用者が直接壊せるファイル**なので、
 * 壊れていることは異常ではなく、そのまま見せて直してもらう分岐の一つ。
 */
export type AssetManifestResult =
  | { readonly ok: true; readonly manifest: AssetManifest }
  | { readonly ok: false; readonly message: string };

/** アセットを 1 つも持たないマニフェスト。 */
export function emptyAssetManifest(): AssetManifest {
  return { version: ASSET_MANIFEST_VERSION, assets: {} };
}

function invalid(message: string): AssetManifestResult {
  return { ok: false, message: `${ASSET_MANIFEST_FILE}: ${message}` };
}

/** アセット 1 件を読む。読めなければ理由を返す。 */
function parseEntry(name: string, value: unknown): AssetEntry | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${name} の中身が不正です`;
  }

  const source = value as Record<string, unknown>;

  if (!isSha256Hex(source.sha256)) {
    return `${name} の sha256 が不正です (64 桁の小文字 16 進)`;
  }
  if (
    typeof source.size !== "number" ||
    !Number.isSafeInteger(source.size) ||
    source.size <= 0
  ) {
    return `${name} の size が不正です (1 以上の整数)`;
  }
  if (!isAssetMime(source.mime)) {
    return `${name} の形式に対応していません`;
  }

  // 知らない項目は落とす。台帳に載るのはこの 3 つだけで、増えた値を持ち回ると
  // 「どこかで読んでいるかもしれない」が消えなくなる。
  return { sha256: source.sha256, size: source.size, mime: source.mime };
}

/**
 * assets.json の中身を読む。
 *
 * 最初の 1 件で止めて返す。書くのは本来 p5stage 側なので、複数の違反を並べるより
 * 「どこが最初に読めなくなったか」が分かる方が直しやすい。
 */
export function parseAssetManifest(text: string): AssetManifestResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid("JSON として読めません");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("オブジェクトではありません");
  }

  const source = value as Record<string, unknown>;

  if (typeof source.version !== "number") {
    return invalid("version がありません");
  }
  if (source.version > ASSET_MANIFEST_VERSION) {
    // 知らない版を読み飛ばすと、こちらが解釈できなかったアセットを保存で
    // 消してしまう。読めないことをそのまま伝える。
    return invalid(
      `新しい形式です (version ${source.version})。p5stage の更新をお待ちください`
    );
  }
  if (source.version !== ASSET_MANIFEST_VERSION) {
    return invalid(`version が不正です (${source.version})`);
  }

  if (
    typeof source.assets !== "object" ||
    source.assets === null ||
    Array.isArray(source.assets)
  ) {
    return invalid("assets がありません");
  }

  const assets: Record<string, AssetEntry> = {};
  for (const [name, raw] of Object.entries(
    source.assets as Record<string, unknown>
  )) {
    const nameError = fileNameError(name);
    if (nameError !== null)
      return invalid(`${JSON.stringify(name)}: ${nameError}`);
    if (name === ASSET_MANIFEST_FILE) {
      return invalid(`${ASSET_MANIFEST_FILE} 自身はアセットにできません`);
    }

    const entry = parseEntry(name, raw);
    if (typeof entry === "string") return invalid(entry);
    assets[name] = entry;
  }

  return { ok: true, manifest: { version: ASSET_MANIFEST_VERSION, assets } };
}

/**
 * assets.json に書き出す文字列。
 *
 * 名前順に並べて整形する。中身が同じなら**必ず同じ文字列**になるので、Gist の
 * リビジョン差分が「実際に変えたアセット」だけになり、履歴が読める形で残る。
 */
export function serializeAssetManifest(manifest: AssetManifest): string {
  const assets: Record<string, AssetEntry> = {};
  for (const name of Object.keys(manifest.assets).sort((a, b) =>
    a.localeCompare(b)
  )) {
    const entry = manifest.assets[name];
    if (entry !== undefined) assets[name] = entry;
  }

  return `${JSON.stringify({ version: manifest.version, assets }, null, 2)}\n`;
}

/**
 * ファイル構成からマニフェストを読む。assets.json が無ければ null。
 *
 * 「無い」と「空」を区別する。空のマニフェストは**アセットを全部消した作品**で、
 * 無いのはアセットを一度も使っていない作品。3-5 の GC はこの区別で参照を数える。
 */
export function readAssetManifest(
  files: SketchFiles
): AssetManifestResult | null {
  const text = files[ASSET_MANIFEST_FILE];
  if (text === undefined) return null;
  return parseAssetManifest(text);
}

/** マニフェストをファイル構成へ載せる (保存経路)。 */
export function withAssetManifest(
  files: SketchFiles,
  manifest: AssetManifest
): SketchFiles {
  return { ...files, [ASSET_MANIFEST_FILE]: serializeAssetManifest(manifest) };
}

/** 参照している blob の sha256 (重複を除く)。所有の確認と GC (3-5) が使う。 */
export function manifestDigests(manifest: AssetManifest): string[] {
  return [
    ...new Set(Object.values(manifest.assets).map((entry) => entry.sha256)),
  ];
}

/**
 * アセット名とコードのファイル名がぶつかっていないか。ぶつかった名前を返す。
 *
 * 実行時の解決は名前で引く (3-3) ので、同じ名前が両方にあるとどちらが返るか
 * 決まらない。**保存の時点で断る**。
 */
export function manifestNameConflicts(
  manifest: AssetManifest,
  files: SketchFiles
): string[] {
  return Object.keys(manifest.assets).filter((name) => name in files);
}
