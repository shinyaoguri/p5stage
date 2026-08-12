/**
 * GitHub の宛先 (Phase 2-7 / ADR 0013)。
 *
 * 本番では定数。差し替えを用意してあるのは E2E のためで、**GitHub を叩くのは Worker**
 * (ADR 0010) である以上、ブラウザ側の仕掛け (Playwright の `page.route` など) では
 * 通しを踏めないため。宛先を替えられて初めて、ログインから保存までを実ブラウザで
 * 追える。
 *
 * 受け付けるのは**ローカルの宛先だけ**。この値は「利用者のアクセストークンを添えて
 * 叩く先」なので、設定を 1 つ間違えた (あるいは書き換えられた) だけでトークンが
 * 外部のホストへ流れる形は作らない。外向きの宛先を渡されたら黙って既定へ倒す。
 */

/** GitHub REST API。 */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** OAuth の認可とトークン交換。API とはホストが違う。 */
export const GITHUB_WEB_ORIGIN = "https://github.com";

export interface GitHubOrigins {
  readonly api: string;
  readonly web: string;
}

const DEFAULT_ORIGINS: GitHubOrigins = {
  api: GITHUB_API_ORIGIN,
  web: GITHUB_WEB_ORIGIN,
};

/**
 * 差し替えを許すホスト。
 *
 * ループバックに限る。名前解決の先が動かないので、他所へ向けられない。
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * 宛先を決める。差し替えが無効なら本物の GitHub。
 *
 * テストダブルは 1 つのサーバで API と OAuth の両方を受ける (パスが重ならない)。
 * 本物は 2 ホストに分かれるので、既定だけ 2 つ持つ。
 */
export function resolveGitHubOrigins(
  override: string | null | undefined
): GitHubOrigins {
  if (override === null || override === undefined || override === "") {
    return DEFAULT_ORIGINS;
  }

  let url: URL;
  try {
    url = new URL(override);
  } catch {
    return DEFAULT_ORIGINS;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return DEFAULT_ORIGINS;
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) return DEFAULT_ORIGINS;

  // パスやクエリを持ち込ませない (`origin` はスキーム + ホスト + ポートだけ)。
  return { api: url.origin, web: url.origin };
}
