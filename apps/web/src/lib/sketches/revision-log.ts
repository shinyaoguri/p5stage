/**
 * リビジョンの台帳 (Phase 4-1 / ADR 0016)。
 *
 * `revision-store.ts` (R2) と対になる D1 側。あちらが**中身**を持ち、こちらは
 * **どの版が存在するか**を持つ。R2 のキーは `gists/<gistId>/<revision>.json` なので、
 * 台帳の主体も作品ではなく Gist にしてある (配られる実体と同じ単位で数える)。
 *
 * 作品から引くときは `sketches.gist_id` を経由する。切り離した作品はそこが NULL に
 * なり、履歴も無くなる — それが切り離しの意味 (ADR 0012)。
 */

/** 台帳の 1 行。 */
export interface RevisionEntry {
  readonly revision: string;
  /**
   * **p5stage が写しを持った時刻**。GitHub のコミット時刻ではない (ADR 0016)。
   * 作者が GitHub 側で直接編集した分は、再検証で気付いた時刻になる。
   */
  readonly createdAt: number;
}

interface RevisionRow {
  readonly revision: string;
  readonly created_at: number;
}

function toEntry(row: RevisionRow): RevisionEntry {
  return { revision: row.revision, createdAt: row.created_at };
}

/**
 * 版を台帳に載せる。
 *
 * 呼ぶのは**中身を R2 へ書けた後**だけ (`storeRevision`)。台帳が意味するのは
 * 「配れるスナップショットがある」ことなので、写しの無い版を載せると一覧から
 * 開けない行が並ぶ。
 *
 * 二度目以降は何も起きない。`created_at` を更新しないのは、並び順が**最初に
 * 現れた順**であってほしいため (閲覧時の埋め合わせで同じ版がもう一度通る)。
 */
export async function recordRevision(
  db: D1Database,
  gistId: string,
  revision: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO gist_revisions (gist_id, revision, created_at)
       VALUES (?, ?, ?)`
    )
    .bind(gistId, revision, now)
    .run();
}

/** 1 回の往復に束ねる件数 (バックフィル用)。 */
const RECORD_CHUNK = 50;

/**
 * まとめて載せる (バックフィル用 — `revision-backfill.ts`)。
 *
 * 1 件ずつ往復すると、R2 の走査 1 バッチ分で D1 への往復が同じ数だけ並ぶ。
 * Cron の持ち時間はそれで埋まってしまうので、束ねて投げる。
 */
export async function recordRevisions(
  db: D1Database,
  entries: readonly {
    readonly gistId: string;
    readonly revision: string;
    readonly createdAt: number;
  }[]
): Promise<void> {
  for (let index = 0; index < entries.length; index += RECORD_CHUNK) {
    const chunk = entries.slice(index, index + RECORD_CHUNK);
    await db.batch(
      chunk.map((entry) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO gist_revisions (gist_id, revision, created_at)
             VALUES (?, ?, ?)`
          )
          .bind(entry.gistId, entry.revision, entry.createdAt)
      )
    );
  }
}

/**
 * 新しい順に引く。
 *
 * 件数を必ず絞る。作者は実行のたびに保存するので (debounce 1.5 秒) 行は伸び続け、
 * **先に困るのは記録ではなく表示**になる (ADR 0016)。
 */
export async function listRevisions(
  db: D1Database,
  gistId: string,
  limit: number
): Promise<RevisionEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT revision, created_at
         FROM gist_revisions
        WHERE gist_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .bind(gistId, limit)
    .all<RevisionRow>();

  return results.map(toEntry);
}

/**
 * その版がこの Gist のものか確かめる。
 *
 * `?rev=` は URL から来る値なので、**R2 を引く前にここを通す** (ADR 0016)。
 * 台帳を見ずに引きに行くと、写しの無い版が配信の埋め合わせ経路 (GitHub) に
 * 落ちてしまう。
 */
export async function findRevision(
  db: D1Database,
  gistId: string,
  revision: string
): Promise<RevisionEntry | null> {
  const row = await db
    .prepare(
      `SELECT revision, created_at
         FROM gist_revisions
        WHERE gist_id = ? AND revision = ?`
    )
    .bind(gistId, revision)
    .first<RevisionRow>();

  return row === null ? null : toEntry(row);
}
