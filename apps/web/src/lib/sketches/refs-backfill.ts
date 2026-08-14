/**
 * 参照台帳のバックフィル (Phase 3-5b)。
 *
 * `blob_refs` に行が積まれるのは `storeRevision` を通ったときだけで (3-5a)、**それ以前に
 * R2 へ書き出されたリビジョンは台帳に無い**。埋めないまま回収を始めると、既存の作品が
 * 使っている実体を全部孤児と見なす。
 *
 * 手掛かりは R2 (`CONTENT`) に残っているリビジョンそのもの。キーから
 * `(gistId, revision)` を、中身からマニフェストを読めば、書いた当時と同じ記録を
 * 作り直せる。**同じ組を二度書いても行は増えない** (`recordRefs`) ので、既に台帳に
 * ある分と重なっても構わない。
 */

import { referencedDigests } from "@p5stage/shared";
import { env } from "cloudflare:workers";

import { recordRefs } from "../assets/store";

import {
  getRevision,
  parseRevisionKey,
  REVISION_KEY_PREFIX,
} from "./revision-store";

export interface BackfillBatch {
  /** 走査したオブジェクトの数。 */
  readonly scanned: number;
  /** 記録できたリビジョンの数 (読めなかったものを除く)。 */
  readonly recorded: number;
  /** 続きの位置。null なら最後まで見終えた。 */
  readonly cursor: string | null;
}

/**
 * 続きから 1 バッチ分だけ進める。
 *
 * 全部を 1 回で舐めないのは、Cron 1 回の持ち時間に収める必要があるため。位置を
 * 呼び出し側 (`gc.ts`) が D1 に持ち越すので、途中で切れても次の起動が続きを拾う。
 */
export async function backfillRefs(
  cursor: string | null,
  limit: number,
  now: number
): Promise<BackfillBatch> {
  const listed = await env.CONTENT.list({
    prefix: REVISION_KEY_PREFIX,
    limit,
    ...(cursor === null ? {} : { cursor }),
  });

  let recorded = 0;
  for (const object of listed.objects) {
    const parsed = parseRevisionKey(object.key);
    if (parsed === null) continue;

    // 読めないものは飛ばす。壊れた写しは配信でも埋め直しの対象になる
    // (`getRevision` が null を返す) ので、守る参照も無い。
    const files = await getRevision(
      env.CONTENT,
      parsed.gistId,
      parsed.revision
    );
    if (files === null) continue;

    await recordRefs(
      env.DB,
      parsed.gistId,
      parsed.revision,
      referencedDigests(files),
      now
    );
    recorded += 1;
  }

  return {
    scanned: listed.objects.length,
    recorded,
    cursor: listed.truncated ? listed.cursor : null,
  };
}
