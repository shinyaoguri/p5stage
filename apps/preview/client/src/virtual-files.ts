/**
 * 実行時のファイル参照 (`loadJSON` / `loadStrings` / `loadShader` など) を
 * スケッチ内のファイルへ解決するための対応表。
 *
 * スケッチは srcdoc 文書なので、相対 URL はランナー文書の URL を基準に解決される。
 * そこで「相対参照が解決されるはずの絶対 URL」を先に計算しておき、ブリッジ側は
 * その表を引くだけにする。判定ロジックをブリッジ (インラインの文字列) に
 * 持たせないことで、実装がここ 1 箇所に収まる。
 */

/**
 * ファイル名 → 実行時 URL の対応から、絶対 URL → 実行時 URL の対応を作る。
 *
 * @param fileUrls ファイル名 → 実行時 URL (コードは blob URL、アセットは配信 URL)
 * @param baseUrl スケッチ文書のベース URL (= ランナー文書の URL)
 */
export function buildRuntimeUrlMap(
  fileUrls: ReadonlyMap<string, string>,
  baseUrl: string
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [name, url] of fileUrls) {
    let absolute: string;
    try {
      absolute = new URL(name, baseUrl).href;
    } catch {
      // ベース URL 側が壊れているとき。解決できない参照は素通りさせる。
      continue;
    }
    map[absolute] = url;
  }
  return map;
}
