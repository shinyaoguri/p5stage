/**
 * リビジョン台帳のバックフィル (Phase 4-1 / ADR 0016)。
 *
 * `gist_revisions` に行が積まれるのは `storeRevision` を通ったときだけで、**4-1 以前に
 * R2 へ書き出された版は台帳に無い**。埋めないと、既に何度も保存されている作品の履歴が
 * 「今の版 1 件」に見える。
 *
 * 手掛かりは参照台帳のバックフィル (3-5b) と同じく R2 (`CONTENT`) のキーだが、
 * **こちらは中身を読まない**。`(gistId, revision)` はキーだけで決まり、写した時刻は
 * R2 のメタデータ (`uploaded`) が持っている — 走査した時刻より、実際に写した時刻の
 * 方が履歴の並びとして正しい。
 *
 * 続きの位置は `gc_state` に持つが、**参照台帳側とは別のキー**にする。あちらは
 * 「済み」を書き込んだら二度と走らないので (`gc.ts`)、相乗りすると既に済んでいる
 * 環境でこちらが一度も走らない。
 */

import { env } from "cloudflare:workers";

import { readGcState, writeGcState } from "../assets/store";

import { recordRevisions } from "./revision-log";
import { parseRevisionKey, REVISION_KEY_PREFIX } from "./revision-store";

/** 続きの位置 (`gc_state`)。 */
const BACKFILL_KEY = "revisions_backfill_cursor";

/** 最後まで舐め終えた印。カーソルと同じ列に置くので、位置に使えない値にする。 */
const BACKFILL_DONE = "done";

/**
 * 1 回の起動で舐めるオブジェクトの数。
 *
 * 中身を読まないので参照台帳側 (200) より多く取れるが、**同じ Cron の中で回収も
 * 走る**ので持ち時間を使い切らない大きさにしておく。台帳への書き込みは
 * `recordRevisions` が束ねるので、ここの数がそのまま往復数にはならない。
 */
const BACKFILL_LIMIT = 300;

export interface RevisionBackfillReport {
  /** 走査したオブジェクトの数。終わっていれば 0。 */
  readonly scanned: number;
  /** 台帳へ載せた版の数 (既にあった分を含む)。 */
  readonly recorded: number;
  /** 舐め終えたか。 */
  readonly done: boolean;
}

/**
 * 続きから 1 バッチ分だけ進める。
 *
 * 全部を 1 回で舐めないのは、Cron 1 回の持ち時間に収める必要があるため。途中で
 * 切れても次の起動が続きを拾う。
 */
export async function runRevisionBackfill(): Promise<RevisionBackfillReport> {
  const cursor = await readGcState(env.DB, BACKFILL_KEY);
  if (cursor === BACKFILL_DONE) return { scanned: 0, recorded: 0, done: true };

  const listed = await env.CONTENT.list({
    prefix: REVISION_KEY_PREFIX,
    limit: BACKFILL_LIMIT,
    ...(cursor === null ? {} : { cursor }),
  });

  const entries = listed.objects.flatMap((object) => {
    const parsed = parseRevisionKey(object.key);
    // 想定外の形のキーは飛ばす。台帳に載せても中身を引けない。
    if (parsed === null) return [];
    return [{ ...parsed, createdAt: object.uploaded.getTime() }];
  });

  await recordRevisions(env.DB, entries);

  const next = listed.truncated ? listed.cursor : null;
  await writeGcState(env.DB, BACKFILL_KEY, next ?? BACKFILL_DONE, Date.now());

  const report = {
    scanned: listed.objects.length,
    recorded: entries.length,
    done: next === null,
  };
  // 回収と同じく結果を残す。履歴が虫食いに見えるときの手掛かりになる。
  console.log(`revision-backfill ${JSON.stringify(report)}`);
  return report;
}
