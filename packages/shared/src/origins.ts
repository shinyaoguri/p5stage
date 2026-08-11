/**
 * 本体サイトと実行 iframe のオリジン構成。
 *
 * p5stage は他者のコードを自動実行するため、実行 iframe は本体と必ず別オリジンに置く
 * (docs/requirements.md 5.1)。オリジンはデプロイ環境ごとに変わる設定値なので、
 * 「別オリジンである」という要件はここで実行時に検証し、構成ミスを起動時に落とす。
 */

/** 検証済みのオリジン構成。web と preview は必ず異なる。 */
export interface Origins {
  /** 本体サイト (エディタ・ギャラリー・API) のオリジン */
  readonly web: string;
  /** 実行 iframe を配信するオリジン。postMessage の origin 検証にも使う */
  readonly preview: string;
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
 * web / preview のオリジンを検証して返す。
 *
 * @throws {OriginConfigError} 値が不正なとき、または両者が同一オリジンのとき
 */
export function resolveOrigins(input: {
  web: string;
  preview: string;
}): Origins {
  const web = normalizeOrigin(input.web, "web");
  const preview = normalizeOrigin(input.preview, "preview");

  if (web === preview) {
    throw new OriginConfigError(
      `実行 iframe は本体と別オリジンである必要があります (どちらも ${web})`
    );
  }

  return { web, preview };
}
