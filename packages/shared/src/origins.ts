/**
 * 本体サイト・実行 iframe・アセット配信のオリジン構成。
 *
 * p5stage は他者のコードを自動実行するため、実行 iframe は本体と必ず別オリジンに置く
 * (docs/requirements.md 5.1)。他者がアップロードしたアセットも本体とも実行環境とも
 * 別のオリジンから配る (ADR 0014)。オリジンはデプロイ環境ごとに変わる設定値なので、
 * 「互いに別オリジンである」という要件はここで実行時に検証し、構成ミスを起動時に落とす。
 */

/** 検証済みのオリジン構成。含まれるオリジンは互いに必ず異なる。 */
export interface Origins {
  /** 本体サイト (エディタ・ギャラリー・API) のオリジン */
  readonly web: string;
  /** 実行 iframe を配信するオリジン。postMessage の origin 検証にも使う */
  readonly preview: string;
  /**
   * アセット (R2 の不変 blob) を配るオリジン。
   *
   * 実行環境はこの値を知らなくてよい (解決済みの URL を本体から受け取る — ADR 0014)
   * ので、渡さなかったときは null になる。
   */
  readonly assets: string | null;
}

/** オリジン構成が要件を満たさないときに投げる。 */
export class OriginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginConfigError";
  }
}

/**
 * 単一の URL 文字列をオリジンへ正規化する。
 * パス・クエリ・末尾スラッシュは落とし、http(s) 以外は拒否する。
 */
function normalizeOrigin(value: string, label: string): string {
  if (value.trim() === "") {
    throw new OriginConfigError(`${label} のオリジンが空です`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OriginConfigError(
      `${label} のオリジンが URL として不正です: ${value}`
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OriginConfigError(
      `${label} のオリジンは http / https のみ許可します: ${value}`
    );
  }

  return url.origin;
}

/**
 * オリジン構成を検証して返す。
 *
 * `assets` は省略できる。実行環境 (preview Worker) はアセットの配信先を知らないまま
 * 動くので、そこでも同じ関数で web / preview の関係を確かめられるようにするため。
 *
 * @throws {OriginConfigError} 値が不正なとき、または同一オリジンが混ざるとき
 */
export function resolveOrigins(input: {
  web: string;
  preview: string;
  assets?: string | null;
}): Origins {
  const web = normalizeOrigin(input.web, "web");
  const preview = normalizeOrigin(input.preview, "preview");

  if (web === preview) {
    throw new OriginConfigError(
      `実行 iframe は本体と別オリジンである必要があります (どちらも ${web})`
    );
  }

  if (input.assets === undefined || input.assets === null) {
    return { web, preview, assets: null };
  }

  const assets = normalizeOrigin(input.assets, "assets");
  if (assets === web || assets === preview) {
    throw new OriginConfigError(
      `アセットは本体とも実行 iframe とも別オリジンである必要があります (${assets})`
    );
  }

  return { web, preview, assets };
}
