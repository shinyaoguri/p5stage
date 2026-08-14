/**
 * アセットを配るオリジン (ADR 0014)。
 *
 * 本体と同じ Worker が 2 つのホスト名で応答する。**どちらの顔で来た要求か**を
 * 判断する場所をここ 1 つにして、middleware (何を出すか) とページ (どの URL を
 * 埋めるか) が同じ値を見るようにする。
 */

import { env } from "cloudflare:workers";

/**
 * 設定値をそのまま返す。未設定なら空文字。
 *
 * 正規化も検証もしないのは、**不正な設定を握り潰さない**ため。ページ側は
 * これを `resolveOrigins` に渡し、本体・実行環境と衝突していれば設定ミスとして
 * 画面に出す。
 */
export function configuredAssetsOrigin(): string {
  const values = env as unknown as Record<string, string | undefined>;
  return values.PUBLIC_ASSETS_ORIGIN ?? "";
}

/**
 * 正規化した配信オリジン。未設定・URL として読めないなら null。
 *
 * 設定が無いときにここで投げないのは、**要求ごとの振り分け**に使う値だからで、
 * 判断は「配信ホストではない」に倒れる (アセットが 404 になるだけで、本体は動く)。
 */
export function assetsOrigin(): string | null {
  const value = configuredAssetsOrigin().trim();
  if (value === "") return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** その要求は配信ホスト宛てか。 */
export function isAssetsHost(url: URL): boolean {
  const origin = assetsOrigin();
  return origin !== null && url.origin === origin;
}
