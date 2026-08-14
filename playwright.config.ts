import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import {
  ASSETS_ORIGIN,
  FAKE_GITHUB_ORIGIN,
  FAKE_GITHUB_PORT,
  PREVIEW_INSPECTOR_PORT,
  PREVIEW_ORIGIN,
  PREVIEW_PORT,
  WEB_INSPECTOR_PORT,
  WEB_ORIGIN,
  WEB_PORT,
} from "./e2e/origins";

/**
 * E2E の対象は「本体 (web) と実行環境 (preview) を別オリジンで立てた構成」
 * (要件 5.1 / ADR 0007)。単体テスト (vitest) が DOM を持たない純ロジックを見るのに対し、
 * ここでは実ブラウザでしか確かめられないもの — オリジン境界・iframe の属性・
 * Worker が付けるヘッダ・Monaco と IndexedDB の実挙動 — を見る。
 *
 * サーバは astro dev ではなく **wrangler dev** で立てる。理由は 2 つ。
 *
 * - preview の `frame-ancestors` は Worker が付けるヘッダで、Worker を通さないと
 *   本番と同じ応答にならない
 * - Astro 7 の `astro dev` は常駐プロセスとして起動して即座に返るため、
 *   Playwright が起動を待てず、終了時に落とすこともできない
 *
 * オリジンは `.dev.vars` ではなく `--var` で渡す。`.dev.vars` は gitignore 済みで
 * CI には無く、手元の値にも依存させたくない。
 */
const appDir = (name: string): string =>
  fileURLToPath(new URL(`apps/${name}/`, import.meta.url));

const isCI = Boolean(process.env.CI);

/** 起動には両アプリのビルドが要る。CI の冷えた環境でも足りる長さにする。 */
const SERVER_TIMEOUT_MS = 180_000;

/**
 * wrangler のローカル状態の置き場。
 *
 * 既定 (`.wrangler/state`) のままだと、開発中の `npm run dev:preview` と
 * E2E のサーバが同じ SQLite を掴んで `SQLITE_BUSY` で落ちる。E2E は専用の
 * 置き場を持ち、開発サーバを止めずに回せるようにする。
 */
const PERSIST_DIR = ".wrangler/e2e";

/**
 * 作品ページ用の種を蒔く。
 *
 * 作品を作るには GitHub の認可が要り、E2E では踏めない。しかし作品ページの
 * 表示・正典 URL への 302・キャッシュヘッダ・別オリジンでの実行は**作品が
 * 1 件も無いと確かめられない**。D1 と R2 に直に置いて、配信経路
 * (D1 のポインタ → R2 の中身) をそのまま踏ませる (ADR 0011)。
 *
 * 種の `revision_checked_at` は今なので再検証の間隔に入らない。
 * つまりこのテストの間、Worker から GitHub へは出ていかない。
 *
 * パスは apps/web から見た相対 (このコマンドは cwd: apps/web で走る)。
 */
const SEED_SQL = "../../e2e/seed.sql";
const SEED_CONTENT = "../../e2e/seed-content.json";
/** アセットを使う作品の中身 (Phase 3-3)。参照する実体は下の SEED_BLOB。 */
const SEED_ASSET_CONTENT = "../../e2e/seed-content-assets.json";
const SEED_OBJECTS = [
  ["e2e-gist-public", SEED_CONTENT],
  ["e2e-gist-unlisted", SEED_CONTENT],
  ["e2e-gist-assets", SEED_ASSET_CONTENT],
]
  .map(
    ([gistId, content]) =>
      `npx wrangler r2 object put p5stage-content/gists/${gistId}/e2erev01.json --file=${content} --content-type=application/json --local --persist-to ${PERSIST_DIR}`
  )
  .join(" && ");

/**
 * アセットの実体 (ADR 0014 の配信対象)。
 *
 * キーは中身の sha256 で、`e2e/fixtures/dot.png` と `e2e/seed-content-assets.json` の
 * マニフェストが同じ値を指す。ずれていないことは `assets.spec.ts` が実ファイルから
 * 計算し直して確かめる。
 */
const SEED_BLOB_SHA256 =
  "7c12c1f9323964065d6b659ec1fe67544707644bf1ce287b9b1c195250adfdfe";
const SEED_BLOB = `npx wrangler r2 object put p5stage-assets/blobs/${SEED_BLOB_SHA256} --file=../../e2e/fixtures/dot.png --content-type=image/png --local --persist-to ${PERSIST_DIR}`;

const SEED_COMMANDS = `npx wrangler d1 execute p5stage --local --persist-to ${PERSIST_DIR} --file=${SEED_SQL} && ${SEED_OBJECTS} && ${SEED_BLOB}`;

/**
 * ビルド成果物を E2E 用に整える (#38 / Phase 3-5b / `e2e/prepare-dev-worker.ts`)。
 *
 * `routes` — 本番のドメインが付いたままだと `wrangler dev` がそれをリクエスト URL の
 * ホストにしてしまい、OAuth の戻り先が本番のドメインになる。
 *
 * `no_bundle` — `--test-scheduled` が開く `/__scheduled` はバンドル時に差し込まれる
 * ミドルウェアなので、「バンドル済み」の印が付いたままだと Cron を起こせない。
 */
const PREPARE_WORKER =
  "node ../../e2e/prepare-dev-worker.ts dist/server/wrangler.json";

/**
 * 孤児 blob を回収するまでの猶予 (時間 — Phase 3-5b)。約 7 秒。
 *
 * 本番は 168 時間 (apps/web/wrangler.jsonc)。0 にしない理由は 2 つある。
 *
 * - **E2E は同じ利用者で並列に走る**。0 にすると、他のテストが手放した直後の実体まで
 *   同じ起動で消えてしまう
 * - 猶予そのもの (手放した直後は消えない) を実ブラウザから確かめられる
 *
 * 待ち時間は `asset-gc.spec.ts` の `GRACE_WAIT_MS` と組。
 */
const GC_GRACE_HOURS = 0.002;

/**
 * サーバの起動を「落ちたら立て直す」層で包む (#38 / `e2e/serve-with-restart.ts`)。
 *
 * `wrangler dev` は E2E の途中でプロセスごと落ちることがある (上流
 * cloudflare/workers-sdk#14926)。素で立てると以降のテストが全部 `ECONNREFUSED` で
 * 倒れるが、立て直せば巻き添えは進行中のテストだけで済み、それは `retries` が拾う。
 */
const SERVE = "node ../../e2e/serve-with-restart.ts";

export default defineConfig({
  testDir: "./e2e",
  // ブラウザを立てるのは `*.spec.ts` だけ。既定の testMatch は `*.test.ts` も拾うので、
  // E2E を支えるスクリプトの単体テスト (`e2e/test/**/*.test.ts` — vitest 側) まで
  // Playwright が実行してしまう。
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // .only の消し忘れで CI が一部しか回らないのを防ぐ。
  forbidOnly: isCI,
  // 実行環境の起動待ちなど、環境由来の揺れだけを 1 回だけ拾い直す。
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_ORIGIN,
    // 別オリジンの iframe を 2 段 (ランナー → スケッチ) 挟むので、
    // 既定の 5 秒では初回の実行が間に合わないことがある。
    actionTimeout: 15_000,
    // 落ちた 1 回目は素通しし、やり直しのときだけ詳細を採る。
    trace: "on-first-retry",
  },
  expect: { timeout: 15_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // セッションは D1 に置くので、起動前にローカルの D1 へスキーマを当てる
      // (CI の使い捨て環境には何も無い状態で来る)。適用済みの分は読み飛ばされる。
      // 続けて作品ページ用の種を蒔く (下の SEED_COMMANDS)。
      //
      // OAuth の値もここで渡す。GitHub の宛先は偽 GitHub (下の webServer) へ向けるので、
      // 素性の分かるダミーで足りる。手元の .dev.vars に依存させないため。
      //
      // ビルドの後に `routes` を外す (下の STRIP_ROUTES)。付いたままだと
      // `wrangler dev` がその custom_domain をリクエスト URL のホストとして使い、
      // OAuth の `redirect_uri` が本番のドメインになって認可から戻れない。
      command: `npm run build && ${PREPARE_WORKER} && npx wrangler d1 migrations apply p5stage --local --persist-to ${PERSIST_DIR} && ${SEED_COMMANDS} && ${SERVE} npx wrangler dev --port ${WEB_PORT} --persist-to ${PERSIST_DIR} --test-scheduled --var PUBLIC_PREVIEW_ORIGIN:${PREVIEW_ORIGIN} --var PUBLIC_ASSETS_ORIGIN:${ASSETS_ORIGIN} --var ASSET_GC_GRACE_HOURS:${GC_GRACE_HOURS} --var GITHUB_CLIENT_ID:e2e-client-id --var GITHUB_CLIENT_SECRET:e2e-client-secret --var GITHUB_TEST_ORIGIN:${FAKE_GITHUB_ORIGIN} --inspector-port ${WEB_INSPECTOR_PORT}`,
      cwd: appDir("web"),
      url: `${WEB_ORIGIN}/edit`,
      reuseExistingServer: !isCI,
      timeout: SERVER_TIMEOUT_MS,
      env: { WRANGLER_SEND_METRICS: "false" },
      // 既定 (ignore) だとサーバが落ちた理由が握り潰され、Playwright 側には
      // 接続拒否しか残らない。原因を追える形で出す。
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run build:client && ${SERVE} npx wrangler dev --port ${PREVIEW_PORT} --persist-to ${PERSIST_DIR} --var PUBLIC_WEB_ORIGIN:${WEB_ORIGIN} --inspector-port ${PREVIEW_INSPECTOR_PORT}`,
      cwd: appDir("preview"),
      url: `${PREVIEW_ORIGIN}/runner/`,
      reuseExistingServer: !isCI,
      timeout: SERVER_TIMEOUT_MS,
      env: { WRANGLER_SEND_METRICS: "false" },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // GitHub の代わりに答えるサーバ (ADR 0013)。ビルドが要らないので素の node で立てる。
      // 起動の確認は TCP で足りる (この口は認証を通さない要求に 2xx を返さない)。
      command: `node e2e/fake-github/server.ts ${FAKE_GITHUB_PORT}`,
      port: FAKE_GITHUB_PORT,
      reuseExistingServer: !isCI,
      timeout: SERVER_TIMEOUT_MS,
      // 未対応の口を叩かれたことに気付けるよう、出力を捨てない。
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
