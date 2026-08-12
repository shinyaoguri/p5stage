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

/**
 * 偽 GitHub (`fake-github/server.ts`)。
 *
 * ログインと保存の通しを踏むには GitHub の往復が要り、それは Worker の中で起きる
 * (ADR 0010 / 0013)。本体の `GITHUB_TEST_ORIGIN` をここへ向ける。
 */
export const FAKE_GITHUB_PORT = 8792;

/**
 * `wrangler dev` が開くデバッガの受け口。
 *
 * 既定は両方とも 9229 で、2 つ同時に立てると**後から起動した方が取り合いに負ける**。
 * サーバの片方が黙って落ちる形になり、症状は「途中まで通ってから接続拒否」になる。
 */
export const WEB_INSPECTOR_PORT = 9230;
export const PREVIEW_INSPECTOR_PORT = 9231;

/** 本体 (エディタ・ギャラリー・API)。 */
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** 実行 iframe を配信するオリジン。 */
export const PREVIEW_ORIGIN = `http://localhost:${PREVIEW_PORT}`;

/**
 * GitHub の代わりに答えるオリジン。
 *
 * 本体はループバック宛てしか受け付けないので (`lib/github/origins.ts`)、
 * ここを別ホストに変えると差し替えごと無効になり、本物の GitHub を叩きにいく。
 */
export const FAKE_GITHUB_ORIGIN = `http://localhost:${FAKE_GITHUB_PORT}`;
