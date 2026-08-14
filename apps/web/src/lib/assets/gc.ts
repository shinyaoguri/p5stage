/**
 * 孤児 blob の回収 (Phase 3-5b)。
 *
 * ADR 0003 の「孤児 blob の GC は参照カウント + 猶予期間で、**公開済みリビジョンが
 * 参照する blob は原則削除しない**」を実装する側。3-1 から 3-5a までで台帳は所有
 * (`user_blobs`) と参照 (`blob_refs`) を持ったが、実体を消す経路がまだ無く、
 * 誰にも計上されず誰にも参照されていない実体が R2 に残り続けていた。
 *
 * 走るのは Cron からだけ (`src/worker.ts`)。外に口を開けない — 判断の材料は全部
 * サーバ側にあり、利用者が起こす理由が無い。
 *
 * **順番に意味がある。**
 *
 * 1. バックフィルが終わるまで回収を始めない。台帳は 3-5a 以降のリビジョンしか
 *    知らないので、埋める前に回収すると既存の作品が使っている実体を孤児と見なす
 * 2. 復活 (`unmarkRevivedBlobs`) を回収より先に。猶予の間に戻ってきたものを消さない
 * 3. 印 (`markOrphanBlobs`) を立ててから回収。猶予 0 の設定では同じ起動で消える
 *    (E2E がこの形を踏む)
 */

import { env } from "cloudflare:workers";

import { backfillRefs } from "../sketches/refs-backfill";

import { deleteBlob } from "./blob-store";
import {
  BACKFILL_LIMIT,
  graceMillis,
  MARK_LIMIT,
  orphanCutoff,
  SWEEP_LIMIT,
} from "./gc-plan";
import {
  dueOrphanBlobs,
  forgetBlob,
  markOrphanBlobs,
  readGcState,
  unmarkRevivedBlobs,
  writeGcState,
} from "./store";

/** バックフィルの続きの位置 (`gc_state`)。 */
const BACKFILL_KEY = "refs_backfill_cursor";

/** 最後まで舐め終えた印。カーソルと同じ列に置くので、位置に使えない値にする。 */
const BACKFILL_DONE = "done";

export interface AssetGcReport {
  /** バックフィルで走査したリビジョンの数。終わっていれば 0。 */
  readonly backfilled: number;
  /** バックフィルが済んでいるか。済むまで回収は動かない。 */
  readonly backfillDone: boolean;
  /** 印を消した (所有か参照が戻った) 数。 */
  readonly revived: number;
  /** 新しく印を立てた数。 */
  readonly marked: number;
  /** 実体と台帳を落とした数。 */
  readonly collected: number;
  /**
   * 実体は消したが台帳から落とせなかった数。
   *
   * 対象を引いてから消すまでの間に所有か参照が戻ると起きる (`forgetBlob` が
   * 条件付きで断る)。**この行は台帳にあるのに実体が無い**状態になるが、claim は
   * R2 の実在を裏取りしてから dedup するので、次の持ち込みで実体が書き戻る。
   */
  readonly stale: number;
}

/** 回収を 1 回分走らせる。 */
export async function runAssetGc(now: number): Promise<AssetGcReport> {
  const backfill = await advanceBackfill(now);
  if (!backfill.done) {
    // まだ台帳が現実に追いついていない。この回は埋めるだけで終える。
    const report = toReport({
      backfilled: backfill.scanned,
      backfillDone: false,
    });
    logReport(report);
    return report;
  }

  const revived = await unmarkRevivedBlobs(env.DB);
  const marked = await markOrphanBlobs(env.DB, now, MARK_LIMIT);

  const cutoff = orphanCutoff(now, graceMillis(env.ASSET_GC_GRACE_HOURS));
  const due = await dueOrphanBlobs(env.DB, cutoff, SWEEP_LIMIT);

  let collected = 0;
  let stale = 0;
  for (const sha256 of due) {
    // R2 → D1 の順。逆にすると台帳から消えて実体だけが残り、回収は `blobs` を
    // 起点に引くので二度と見つけられない。
    await deleteBlob(env.BLOBS, sha256);
    if (await forgetBlob(env.DB, sha256)) collected += 1;
    else stale += 1;
  }

  const report = toReport({
    backfilled: backfill.scanned,
    backfillDone: true,
    revived,
    marked,
    collected,
    stale,
  });
  logReport(report);
  return report;
}

function toReport(partial: Partial<AssetGcReport>): AssetGcReport {
  return {
    backfilled: 0,
    backfillDone: false,
    revived: 0,
    marked: 0,
    collected: 0,
    stale: 0,
    ...partial,
  };
}

/**
 * 回収の結果は必ず残す (observability は wrangler.jsonc で有効)。
 *
 * 消したものは戻せないので、**何をどれだけ消したか**が後から追えないと、実体が
 * 消えた作品の原因を調べる手掛かりが無くなる。
 */
function logReport(report: AssetGcReport): void {
  console.log(`asset-gc ${JSON.stringify(report)}`);
}

/** バックフィルを 1 バッチ進める。済んでいれば何もしない。 */
async function advanceBackfill(
  now: number
): Promise<{ readonly done: boolean; readonly scanned: number }> {
  const state = await readGcState(env.DB, BACKFILL_KEY);
  if (state === BACKFILL_DONE) return { done: true, scanned: 0 };

  const batch = await backfillRefs(state, BACKFILL_LIMIT, now);
  await writeGcState(env.DB, BACKFILL_KEY, batch.cursor ?? BACKFILL_DONE, now);

  return { done: batch.cursor === null, scanned: batch.scanned };
}
