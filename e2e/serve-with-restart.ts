/**
 * `wrangler dev` が落ちても E2E 全体を巻き添えにしない (#38)。
 *
 * ローカルの dev サーバは、workerd がクラッシュしたあと miniflare が自動で立て直しても
 * wrangler がそれに追随できず、**プロセスごと終了する**ことがある
 * (上流 cloudflare/workers-sdk#14926。2026-08-14 時点で未修正)。落ちるときに残るのは
 * 本文の無い `✘ [ERROR]` だけなので、Playwright 側には接続拒否しか届かず、
 * 以降のテストが全部倒れる。
 *
 * ここで立て直せば、巻き添えになるのは進行中のテストだけで済む (それは Playwright の
 * `retries` が拾える)。**症状は隠さない** — 落ちたことは stderr に出し、続けて落ちるなら
 * 諦めて失敗させる。上流が直ったら、この層ごと外す。
 */

import { spawn, type ChildProcess } from "node:child_process";

/** 続けて落ちるならもう環境の問題なので、諦めて CI を赤くする。 */
const RESTART_LIMIT = Number(process.env.E2E_SERVER_RESTART_LIMIT ?? "3");

const [bin, ...args] = process.argv.slice(2);

if (bin === undefined) {
  console.error("usage: node e2e/serve-with-restart.ts <command> [args...]");
  process.exit(1);
}

let stopping = false;
let restarts = 0;
let child: ChildProcess | undefined;

const stop = (signal: NodeJS.Signals): void => {
  stopping = true;
  child?.kill(signal);
};

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

const start = (): void => {
  /*
   * **`detached` にはしない** — 子は自分と同じプロセスグループに置く。
   *
   * Playwright はサーバを止めるとき webServer のプロセスグループごと落とす。
   * 子を別グループに切り離すと、その kill が子まで届かず、**`wrangler dev` が
   * 孤児 (PPID 1) として生き残ってテストが終わらない**。実際に踏んだ。
   *
   * 孫 (workerd / esbuild) の後始末は wrangler 自身が受け持つ。
   */
  child = spawn(bin, args, { stdio: "inherit" });

  child.on("error", (error) => {
    console.error(`[serve-with-restart] 起動できません: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    // Playwright に止められた分は立て直さない (テストはもう終わっている)。
    if (stopping) {
      process.exit(code ?? 0);
    }

    if (restarts >= RESTART_LIMIT) {
      console.error(
        `[serve-with-restart] サーバが ${restarts + 1} 回落ちました。諦めます (#38)`
      );
      process.exit(code ?? 1);
    }

    restarts += 1;
    console.error(
      `[serve-with-restart] サーバが落ちました (code=${code ?? "null"} signal=${signal ?? "null"})。立て直します ${restarts}/${RESTART_LIMIT} (#38)`
    );
    // ポートが解放されるまでのわずかな間を置く。
    setTimeout(start, 200);
  });
};

start();
