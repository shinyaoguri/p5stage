/**
 * 作品のアセット一覧 (assets.json) の読み書き — 画面から切り離した純ロジック (Phase 3-4)。
 *
 * **マニフェストの正本はエディタが持つファイルそのもの**で、この層は写しを持たない。
 * 手で編集する道は 3-2 が意図して残してある (壊れたものを直す手段が要る) ため、
 * パネルが自分の中に一覧を抱えると、手で直した内容を次の操作で踏み潰す。
 * 読むのも書くのも、そのときのファイル構成を渡してもらう形にしてある。
 *
 * 形と検証の正本は `@p5stage/shared` の `asset-manifest.ts`。ここが足すのは
 * **編集の作法**だけ (どの名前を使えるか・重複したらどうするか)。
 */

import {
  ASSET_MANIFEST_FILE,
  emptyAssetManifest,
  fileNameError,
  readAssetManifest,
  serializeAssetManifest,
  type AssetEntry,
  type AssetManifest,
  type SketchFiles,
} from "@p5stage/shared";

/** 一覧に並ぶアセット 1 件。 */
export interface ManifestAsset {
  /** コードから引く名前 (`loadImage("cat.png")`)。 */
  readonly name: string;
  readonly entry: AssetEntry;
}

/**
 * いまのファイル構成から見たアセットの状態。
 *
 * 「assets.json が無い」は**アセットが 0 件**と同じものとして扱う。無いと空の
 * 区別は保存経路と GC (3-5) には要るが、画面では「まだ無い」で足りる。
 */
export type ManifestState =
  | {
      readonly kind: "ok";
      readonly manifest: AssetManifest;
      /** 名前順。`serializeAssetManifest` の並びと揃えてある。 */
      readonly assets: readonly ManifestAsset[];
    }
  /** 読めない。直すまで足すことも外すこともできない。 */
  | { readonly kind: "invalid"; readonly message: string };

/** 書き換えの結果。断るときは理由をそのまま画面に出す。 */
export type ManifestEdit =
  | {
      readonly ok: true;
      /** 書き戻す `assets.json` の中身。 */
      readonly content: string;
      /** 実際に付いた名前 (重複を避けて変えることがある)。 */
      readonly name: string;
      /** 何も変わらなかった (同じ名前で同じ中身が既にある)。 */
      readonly unchanged: boolean;
    }
  | { readonly ok: false; readonly message: string };

/** いまのファイル構成のアセットを読む。 */
export function readManifestState(files: SketchFiles): ManifestState {
  const result = readAssetManifest(files);
  if (result !== null && !result.ok) {
    return { kind: "invalid", message: result.message };
  }

  const manifest = result === null ? emptyAssetManifest() : result.manifest;
  const assets = Object.keys(manifest.assets)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, entry: manifest.assets[name] as AssetEntry }));

  return { kind: "ok", manifest, assets };
}

/**
 * その名前は既に埋まっているか。
 *
 * コードのファイル名も一緒に見る。実行時の解決は 1 つの表で引く (3-3) ので、
 * 同じ名前が両方にあると**保存の時点で断られる** (`manifestNameConflicts`)。
 * 断られる形を作らないよう、名前を決める側で避ける。
 */
function takenNames(files: SketchFiles, manifest: AssetManifest): Set<string> {
  return new Set([...Object.keys(files), ...Object.keys(manifest.assets)]);
}

/**
 * 空いている名前を返す。埋まっていれば `cat-2.png` のように連番を足す。
 *
 * 上書きしないのは、コードの `loadImage("cat.png")` が**黙って別の絵に変わる**のを
 * 避けるため。中身が違えば別のアセットとして持つ方が、content-addressed な実体
 * (ADR 0003) の見え方とも揃う。
 */
export function uniqueAssetName(
  name: string,
  taken: ReadonlySet<string>
): string {
  if (!taken.has(name)) return name;

  // 拡張子は残す。形式の手掛かり (p5 の `loadModel` は末尾で判定する — ADR 0014)
  // を落とすと、名前を変えた途端に読めなくなる。
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";

  // 埋まっている数より多く試せば必ず空きが見つかる。
  for (let suffix = 2; suffix <= taken.size + 2; suffix += 1) {
    const candidate = `${base}-${suffix}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  return name;
}

/** アセットの名前として使えない理由。使えるなら null。 */
export function assetNameError(name: string): string | null {
  const error = fileNameError(name);
  if (error !== null) return error;
  if (name === ASSET_MANIFEST_FILE) {
    return `${ASSET_MANIFEST_FILE} はアセットの一覧に使う名前です`;
  }
  return null;
}

/**
 * アセットを 1 件足す。
 *
 * 同じ名前で同じ実体が既にあるなら何もしない (`unchanged`)。同じ素材を二度
 * 落としただけで名前が増えると、参照されないアセットが作品に溜まる。
 */
export function addAsset(
  files: SketchFiles,
  rawName: string,
  entry: AssetEntry
): ManifestEdit {
  const state = readManifestState(files);
  if (state.kind === "invalid") return refuseInvalid(state.message);

  // 端末から来る名前は前後に空白が付くことがある。落として通す方が、
  // 「ファイル名の前後に空白は使えません」と断るより利用者の手が減る。
  const name = rawName.trim();
  const error = assetNameError(name);
  if (error !== null) return { ok: false, message: error };

  const existing = state.manifest.assets[name];
  if (existing?.sha256 === entry.sha256) {
    return {
      ok: true,
      content: serializeAssetManifest(state.manifest),
      name,
      unchanged: true,
    };
  }

  const unique = uniqueAssetName(name, takenNames(files, state.manifest));
  const manifest: AssetManifest = {
    version: state.manifest.version,
    assets: { ...state.manifest.assets, [unique]: entry },
  };
  return {
    ok: true,
    content: serializeAssetManifest(manifest),
    name: unique,
    unchanged: false,
  };
}

/**
 * アセットを 1 件外す。
 *
 * 実体 (R2 の blob) には触れない。**外すのは作品からの参照だけ**で、所有は
 * 残るので同じものを落とし直せば転送なしで戻る (ADR 0003 の dedup)。
 * 所有そのものを手放す口は 3-4b。
 */
export function removeAsset(files: SketchFiles, name: string): ManifestEdit {
  const state = readManifestState(files);
  if (state.kind === "invalid") return refuseInvalid(state.message);

  if (!(name in state.manifest.assets)) {
    return { ok: false, message: `${name} は作品のアセットにありません` };
  }

  const assets = { ...state.manifest.assets };
  delete assets[name];
  // 空になっても assets.json は消さない。空のマニフェストは「アセットを全部
  // 外した作品」で、無いのは「一度も使っていない作品」— 3-5 の GC はこの区別で
  // 参照を数える。
  const manifest: AssetManifest = { version: state.manifest.version, assets };
  return {
    ok: true,
    content: serializeAssetManifest(manifest),
    name,
    unchanged: false,
  };
}

/** 読めないマニフェストへの書き込みを断る。 */
function refuseInvalid(message: string): ManifestEdit {
  return { ok: false, message: `${message} (直すまで変えられません)` };
}
