/**
 * E2E で立てる 2 つのサーバのオリジン。
 *
 * 「本体と実行環境が別オリジンであること」自体が検証対象なので (要件 5.1 /
 * ADR 0007)、テスト側もオリジンを 2 つ持つ。playwright.config.ts はここの値で
 * サーバを起動し、テストはここの値で「どちらのオリジンか」を確かめる。
 *
 * ポートは開発用のサーバ (astro dev の 4321 / preview の 8788) と分けてある。
 * E2E を回すたびに開発サーバを止めなくて済むようにするため。
 */

export const WEB_PORT = 8790;
export const PREVIEW_PORT = 8791;

/** 本体 (エディタ・ギャラリー・API)。 */
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** 実行 iframe を配信するオリジン。 */
export const PREVIEW_ORIGIN = `http://localhost:${PREVIEW_PORT}`;
