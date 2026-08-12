/**
 * セッション cookie の組み立てと読み取り (ADR 0008)。
 *
 * 実行環境 `preview.p5stage.org` は本体と **same-site** なので、preview 上で動く他者コードは
 * `domain=.p5stage.org` の cookie を書ける (cookie tossing)。`__Host-` プレフィックスは
 * 「Secure かつ Path=/ かつ Domain 属性なし」をブラウザが強制する印で、この条件を満たす
 * cookie は**サブドメインから上書きも削除もできない**。だから名前の側で守る。
 *
 * 前提として、`SameSite` は CSRF 防御に数えない (same-site サブドメインからの要求は
 * `Lax` を素通りする)。状態を変える口は `origin-guard.ts` で別途守る。
 */

/** ログインセッション。`__Host-` は飾りではなく、上書き不能性の要件そのもの。 */
export const SESSION_COOKIE = "__Host-p5stage_session";

/** OAuth の往復で state を持ち回るための短命な cookie。 */
export const STATE_COOKIE = "__Host-p5stage_oauth_state";

/** セッションの寿命。長すぎると盗まれたときの窓が広がる。 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

/** state cookie の寿命。認可画面での操作にかかる時間だけあれば足りる。 */
const STATE_MAX_AGE_SECONDS = 60 * 10;

/**
 * `__Host-` の要件をコードの側にも書いておく。
 *
 * `Secure` は localhost でもブラウザが安全なコンテキストとして扱うため、
 * http のローカル開発でもそのまま動く。
 */
function hostCookieAttributes(maxAgeSeconds: number): string {
  return [
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

/** ログイン時に発行する `Set-Cookie` の値。 */
export function buildSessionCookie(rawId: string): string {
  return `${SESSION_COOKIE}=${rawId}; ${hostCookieAttributes(SESSION_MAX_AGE_SECONDS)}`;
}

/** ログアウト時に消す `Set-Cookie` の値。 */
export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${hostCookieAttributes(0)}`;
}

/** 認可画面へ送り出す前に置く state。 */
export function buildStateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; ${hostCookieAttributes(STATE_MAX_AGE_SECONDS)}`;
}

/** 使い終わった state を消す。往復 1 回で必ず捨てる (再利用させない)。 */
export function buildClearedStateCookie(): string {
  return `${STATE_COOKIE}=; ${hostCookieAttributes(0)}`;
}

/**
 * `Cookie` ヘッダから 1 つ取り出す。
 *
 * 同じ名前が複数あるときは**最初に現れたものを採る**。`__Host-` は上書きされない前提だが、
 * 名前の重複そのものは cookie tossing で起こりうるので、挙動を決めておく。
 */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    return value === "" ? null : value;
  }

  return null;
}
