/**
 * アセットの配信 URL (ADR 0014)。
 *
 * 組み立てるのは本体で、実行環境は解決済みの表を受け取るだけ。**URL の形を知って
 * いるのはここ 1 箇所**にして、配る側 (`/a/[sha256]/[name]`) と参照を作る側で
 * 食い違わないようにする。
 */

import { readAssetManifest, type AssetManifest } from "./asset-manifest";
import { isSha256Hex } from "./assets";
import type { SketchFiles } from "./files";

/**
 * 配信のパスの頭。
 *
 * 本体のホストではこの下を出さず、アセットのホストではこの下しか出さない
 * (同じ Worker が 2 つの顔を持つため — ADR 0014)。
 */
export const ASSET_ROUTE_PREFIX = "/a/";

/**
 * 配信のパス。
 *
 * 引く鍵は sha256 だけで、**ファイル名は無視される**。それでも名前を付けるのは、
 * p5 の `loadModel` が拡張子 (パスの末尾 4 文字) で形式を判定するため。
 */
export function assetPath(sha256: string, name: string): string {
  return `${ASSET_ROUTE_PREFIX}${sha256}/${encodeURIComponent(name)}`;
}

/** 配信の絶対 URL。 */
export function assetUrl(
  assetsOrigin: string,
  sha256: string,
  name: string
): string {
  return new URL(assetPath(sha256, name), assetsOrigin).href;
}

/**
 * マニフェストを「ファイル名 → 配信 URL」の表にする。
 *
 * 実行時の解決はこの表を引くだけになる (ランナーはマニフェストを読まない)。
 */
export function assetUrlsFromManifest(
  manifest: AssetManifest,
  assetsOrigin: string
): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [name, entry] of Object.entries(manifest.assets)) {
    // パーサを通っていれば必ず妥当だが、URL に載る値なのでここでも確かめる。
    if (!isSha256Hex(entry.sha256)) continue;
    urls[name] = assetUrl(assetsOrigin, entry.sha256, name);
  }
  return urls;
}

/**
 * ファイル構成から実行時の表を作る。
 *
 * assets.json が無い・壊れている・配信オリジンが無いときは**空の表**を返す。
 * ここで投げないのは、アセットが解決できないことはスケッチを動かさない理由には
 * ならないため。壊れたマニフェストの知らせはエディタと保存経路が受け持つ (3-2)。
 */
export function assetUrlsForFiles(
  files: SketchFiles,
  assetsOrigin: string | null
): Record<string, string> {
  if (assetsOrigin === null) return {};

  const result = readAssetManifest(files);
  if (result === null || !result.ok) return {};

  return assetUrlsFromManifest(result.manifest, assetsOrigin);
}
