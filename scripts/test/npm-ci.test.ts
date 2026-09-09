/**
 * `npm-ci.sh` のやり直し方 (#131)。
 *
 * 見るのは 2 つ — **レジストリの瞬断はやり直す**ことと、**何度試しても同じ失敗は
 * やり直さない**こと。後者が壊れると、lock の不整合のような直らない失敗を待たされる。
 *
 * 本物の `npm ci` は呼ばない。実行コマンドを `NPM_CI_CMD` で偽物に差し替え、
 * 何回呼ばれたかと終了コードだけを見る。
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../npm-ci.sh", import.meta.url));

/** npm がネットワーク由来のときに出す行。判定はこの形に依っている。 */
const NETWORK_ERROR = [
  "npm error code ECONNRESET",
  "npm error syscall read",
  "npm error network read ECONNRESET",
].join("\n");

/** 何度やり直しても同じもの。package-lock が package.json と食い違っているとき。 */
const LOCK_ERROR = [
  "npm error code EUSAGE",
  "npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.",
].join("\n");

let dir: string;
let counter: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "npm-ci-"));
  counter = join(dir, "calls");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * 呼ばれるたびに印を 1 つ足す偽 npm。`failUntil` 回目までは `message` を吐いて失敗し、
 * それ以降は成功する (`failUntil` に Infinity 相当を渡せば常に失敗)。
 */
const fakeNpm = async (message: string, failUntil: number): Promise<string> => {
  const path = join(dir, "fake-npm.sh");
  // エラー文はファイルへ逃がして `cat` で吐く。npm の文言にはバッククォートが混ざり、
  // スクリプトへ直接埋めるとコマンド置換として実行されてしまう。
  const messagePath = join(dir, "fake-npm-message.txt");
  await writeFile(messagePath, `${message}\n`);
  await writeFile(
    path,
    [
      "#!/usr/bin/env bash",
      `printf 'x' >> ${JSON.stringify(counter)}`,
      `calls=$(wc -c < ${JSON.stringify(counter)})`,
      `if [ "$calls" -le ${failUntil} ]; then`,
      `  cat ${JSON.stringify(messagePath)} >&2`,
      "  exit 1",
      "fi",
      'echo "added 1 package"',
      "exit 0",
    ].join("\n"),
    { mode: 0o755 }
  );
  return path;
};

const callsSoFar = async (): Promise<number> => {
  try {
    return (await readFile(counter, "utf8")).length;
  } catch {
    return 0;
  }
};

/** スクリプトを走らせて終了コードを返す。待ち時間は 0 に潰す。 */
const run = (fake: string, attempts = 3): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(SCRIPT, {
      env: {
        ...process.env,
        NPM_CI_CMD: `bash ${fake}`,
        NPM_CI_SLEEP: "0",
        NPM_CI_ATTEMPTS: String(attempts),
      },
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? -1));
  });

describe("npm-ci.sh", () => {
  it("1 回で通ればやり直さない", async () => {
    const code = await run(await fakeNpm(NETWORK_ERROR, 0));
    expect(code).toBe(0);
    expect(await callsSoFar()).toBe(1);
  });

  it("ネットワーク由来の失敗はやり直す", async () => {
    const code = await run(await fakeNpm(NETWORK_ERROR, 1));
    expect(code).toBe(0);
    expect(await callsSoFar()).toBe(2);
  });

  it("ネットワーク由来でない失敗はやり直さない", async () => {
    const code = await run(await fakeNpm(LOCK_ERROR, 99));
    expect(code).toBe(1);
    expect(await callsSoFar()).toBe(1);
  });

  it("やり直しの上限まで試して諦める", async () => {
    const code = await run(await fakeNpm(NETWORK_ERROR, 99));
    expect(code).toBe(1);
    expect(await callsSoFar()).toBe(3);
  });
});
