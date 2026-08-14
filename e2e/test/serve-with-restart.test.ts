/**
 * `serve-with-restart` の振る舞い (#38)。
 *
 * 見るのは 2 つだけ — **落ちたら立て直す**ことと、**止められたら立て直さない**こと。
 * 後者が壊れると Playwright がサーバを終えられず、E2E が終了しなくなる。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const WRAPPER = fileURLToPath(
  new URL("../serve-with-restart.ts", import.meta.url)
);

let dir: string;
let counter: string;
/** 途中で落ちたテストが偽サーバを置き去りにしないよう、起動した分を控えておく。 */
let spawned: ChildProcess[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "serve-with-restart-"));
  counter = join(dir, "starts");
  spawned = [];
});

afterEach(async () => {
  // SIGKILL ではなく SIGTERM。孫 (偽サーバ) を落とすのは包んでいる側の仕事で、
  // SIGKILL ではその後始末が走らない。
  for (const child of spawned) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  await rm(dir, { recursive: true, force: true });
});

/** 起動されるたびに印を 1 つ足す偽サーバ。`tail` で終わり方を変える。 */
const fakeServer = (tail: string): string =>
  `require("node:fs").appendFileSync(${JSON.stringify(counter)}, "x");${tail}`;

const startsSoFar = async (): Promise<number> => {
  try {
    return (await readFile(counter, "utf8")).length;
  } catch {
    return 0;
  }
};

const waitForStarts = async (want: number): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await startsSoFar()) >= want) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`偽サーバが ${want} 回起動しませんでした`);
};

interface Run {
  readonly code: number | null;
  readonly stderr: string;
}

const runWrapper = (
  tail: string,
  limit: string,
  onStarted?: (kill: () => void) => Promise<void>
): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn("node", [WRAPPER, "node", "-e", fakeServer(tail)], {
      env: { ...process.env, E2E_SERVER_RESTART_LIMIT: limit },
      stdio: ["ignore", "ignore", "pipe"],
    });
    spawned.push(child);

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stderr });
    });

    void onStarted?.(() => child.kill("SIGTERM")).catch(reject);
  });

describe("serve-with-restart", () => {
  it("落ちたら立て直し、上限を超えたら諦める", async () => {
    const { code, stderr } = await runWrapper("process.exit(1)", "2");

    // 初回 + 立て直し 2 回。
    expect(await startsSoFar()).toBe(3);
    expect(code).not.toBe(0);
    expect(stderr).toContain("立て直します 1/2");
    expect(stderr).toContain("諦めます");
  });

  it("プロセスグループごと落とされたら子も道連れになる", async () => {
    // Playwright はサーバを止めるとき webServer のプロセスグループごと落とす。
    // 子を別グループに切り離すと `wrangler dev` が孤児として生き残り、
    // **E2E が終わらなくなる** (実際に踏んだ)。
    const pidFile = join(dir, "child.pid");
    const child = spawn(
      "node",
      [
        WRAPPER,
        "node",
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(() => {}, 1000)`,
      ],
      // 新しいプロセスグループのリーダーにして、グループごと落とせるようにする。
      { detached: true, stdio: ["ignore", "ignore", "ignore"] }
    );
    spawned.push(child);

    const deadline = Date.now() + 5_000;
    let childPid = 0;
    while (Date.now() < deadline && childPid === 0) {
      try {
        childPid = Number(await readFile(pidFile, "utf8"));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    expect(childPid).toBeGreaterThan(0);

    process.kill(-(child.pid ?? 0), "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 300));

    // シグナル 0 は「届くか」だけを見る。生きていれば投げない。
    expect(() => process.kill(childPid, 0)).toThrow();
  });

  it("止められたら立て直さない", async () => {
    const { stderr } = await runWrapper(
      "setInterval(() => {}, 1000)",
      "3",
      async (kill) => {
        await waitForStarts(1);
        kill();
      }
    );

    expect(await startsSoFar()).toBe(1);
    expect(stderr).not.toContain("立て直します");
  });
});
