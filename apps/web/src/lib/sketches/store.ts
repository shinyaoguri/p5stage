/**
 * 作品メタデータの読み書き (D1)。
 *
 * 所有者の確認はここで一緒にやる。「引いてから呼び出し側で持ち主を比べる」形にすると、
 * 比べ忘れた口が 1 つでもあれば他人の作品を書き換えられてしまうため、
 * **更新系は必ず owner_id を条件に含める**。
 */

import { generateSketchId } from "./id";
import type {
  Sketch,
  SketchInput,
  SketchPatch,
  SketchWithOwner,
  Visibility,
} from "./sketch";

interface SketchRow {
  readonly id: string;
  readonly owner_id: number;
  readonly gist_id: string | null;
  readonly title: string;
  readonly description: string;
  readonly visibility: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly current_revision: string | null;
  readonly revision_etag: string | null;
  readonly revision_checked_at: number | null;
  readonly gist_deleted_at: number | null;
}

interface SketchWithOwnerRow extends SketchRow {
  readonly owner_login: string;
  readonly owner_avatar_url: string | null;
}

const COLUMN_NAMES = [
  "id",
  "owner_id",
  "gist_id",
  "title",
  "description",
  "visibility",
  "created_at",
  "updated_at",
  "current_revision",
  "revision_etag",
  "revision_checked_at",
  "gist_deleted_at",
] as const;

const COLUMNS = COLUMN_NAMES.join(", ");

/** 結合したときに列名がぶつからないよう、表の別名を付けた並び。 */
const SKETCH_COLUMNS = COLUMN_NAMES.map((name) => `s.${name}`).join(", ");

function toSketch(row: SketchRow): Sketch {
  return {
    id: row.id,
    ownerId: row.owner_id,
    gistId: row.gist_id,
    title: row.title,
    description: row.description,
    // CHECK 制約が値を縛っているので、ここでの絞り込みは型を合わせるためだけ。
    visibility: row.visibility as Visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentRevision: row.current_revision,
    revisionEtag: row.revision_etag,
    revisionCheckedAt: row.revision_checked_at,
    gistDeletedAt: row.gist_deleted_at,
  };
}

/** 作品の器を作る。Gist はまだ紐付かない (2-3 で書き出す)。 */
export async function createSketch(
  db: D1Database,
  ownerId: number,
  input: SketchInput,
  now: number
): Promise<Sketch> {
  const id = generateSketchId();

  await db
    .prepare(
      `INSERT INTO sketches
         (id, owner_id, gist_id, title, description, visibility, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      ownerId,
      input.title,
      input.description,
      input.visibility,
      now,
      now
    )
    .run();

  return {
    id,
    ownerId,
    gistId: null,
    title: input.title,
    description: input.description,
    visibility: input.visibility,
    createdAt: now,
    updatedAt: now,
    currentRevision: null,
    revisionEtag: null,
    revisionCheckedAt: null,
    gistDeletedAt: null,
  };
}

/**
 * 作品を作者ごと引く。作品ページが要るのはこの形 (ログイン不要 — 要件 3.4)。
 *
 * 引く鍵は sketchId だけ。URL に載る login は表示のための飾りで、検索条件にしない
 * (`users.login` は改名で変わるため — ADR 0011)。
 */
export async function getSketchWithOwner(
  db: D1Database,
  id: string
): Promise<SketchWithOwner | null> {
  const row = await db
    .prepare(
      `SELECT ${SKETCH_COLUMNS},
              u.login AS owner_login, u.avatar_url AS owner_avatar_url
         FROM sketches s
         JOIN users u ON u.id = s.owner_id
        WHERE s.id = ?`
    )
    .bind(id)
    .first<SketchWithOwnerRow>();

  if (row === null) return null;
  return {
    ...toSketch(row),
    ownerLogin: row.owner_login,
    ownerAvatarUrl: row.owner_avatar_url,
  };
}

/**
 * ID で引く。
 *
 * 公開範囲で絞らない。`unlisted` は「URL を知る人は見られる」という約束なので、
 * ID を知っていることが閲覧の条件そのものになる (要件 3.4)。
 */
export async function getSketch(
  db: D1Database,
  id: string
): Promise<Sketch | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM sketches WHERE id = ?`)
    .bind(id)
    .first<SketchRow>();

  return row === null ? null : toSketch(row);
}

/** 作者の作品を新しい順に。 */
export async function listSketchesByOwner(
  db: D1Database,
  ownerId: number,
  limit: number
): Promise<Sketch[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM sketches
        WHERE owner_id = ?
        ORDER BY updated_at DESC
        LIMIT ?`
    )
    .bind(ownerId, limit)
    .all<SketchRow>();

  return results.map(toSketch);
}

/**
 * メタデータを更新する。持ち主でなければ何も起きず false を返す。
 *
 * 「見つからない」と「持ち主ではない」を区別しない。区別して返すと、他人の作品の
 * 存在を ID から確かめられてしまう (unlisted の前提が崩れる)。
 */
export async function updateSketch(
  db: D1Database,
  id: string,
  ownerId: number,
  patch: SketchPatch,
  now: number
): Promise<Sketch | null> {
  const assignments: string[] = [];
  const values: (string | number)[] = [];

  if (patch.title !== undefined) {
    assignments.push("title = ?");
    values.push(patch.title);
  }
  if (patch.description !== undefined) {
    assignments.push("description = ?");
    values.push(patch.description);
  }
  if (patch.visibility !== undefined) {
    assignments.push("visibility = ?");
    values.push(patch.visibility);
  }
  if (assignments.length === 0) return null;

  assignments.push("updated_at = ?");
  values.push(now);

  const result = await db
    .prepare(
      `UPDATE sketches SET ${assignments.join(", ")}
        WHERE id = ? AND owner_id = ?`
    )
    .bind(...values, id, ownerId)
    .run();

  // 0 行なら「無い」か「他人のもの」。どちらも呼び出し側の扱いは同じ。
  if (result.meta.changes === 0) return null;
  return getSketch(db, id);
}

/**
 * 更新時刻だけを進める。Gist へ書き出したときに使う。
 *
 * メタデータは変わらないが、一覧の並び (updated_at DESC) は「最後に手を入れた順」で
 * ないと役に立たない。持ち主でなければ何も起きない。
 */
export async function touchSketch(
  db: D1Database,
  id: string,
  ownerId: number,
  now: number
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE sketches SET updated_at = ? WHERE id = ? AND owner_id = ?")
    .bind(now, id, ownerId)
    .run();

  return result.meta.changes > 0;
}

/**
 * Gist を紐付ける。
 *
 * 既に紐付いている作品は上書きしない。付け替えは detach を経由させたいので、
 * ここは「まだ無いときだけ書く」に限る。**別タブが先に紐付けていたときに
 * 気付ける**ようにもなっている (false が返る)。
 */
export async function attachGist(
  db: D1Database,
  id: string,
  ownerId: number,
  gistId: string,
  now: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE sketches SET gist_id = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND gist_id IS NULL`
    )
    .bind(gistId, now, id, ownerId)
    .run();

  return result.meta.changes > 0;
}

/**
 * 配信するリビジョンを進める (ADR 0011)。
 *
 * 所有者で絞らない。**これは持ち主が決める値ではなく、GitHub にある事実の写し**で、
 * 保存経路だけでなく閲覧時の再検証からも書かれる (そこにログイン中の人はいない)。
 * 書き換えの入口は id を自分で引き当てた経路に限られる。
 *
 * tombstone も一緒に外す。消えたと判断した Gist が読めたなら、その判断は誤りだった
 * (作者が復元した・一時的な 404 だった) ことになる。
 */
export async function setCurrentRevision(
  db: D1Database,
  id: string,
  revision: string,
  etag: string | null,
  now: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE sketches
          SET current_revision = ?, revision_etag = ?, revision_checked_at = ?,
              gist_deleted_at = NULL
        WHERE id = ?`
    )
    .bind(revision, etag, now, id)
    .run();
}

/** 突き合わせたが変わっていなかった。次に確かめるまでの時計を進めるだけ。 */
export async function markRevisionChecked(
  db: D1Database,
  id: string,
  now: number
): Promise<void> {
  await db
    .prepare("UPDATE sketches SET revision_checked_at = ? WHERE id = ?")
    .bind(now, id)
    .run();
}

/**
 * Gist が GitHub 側で消えた印を立てる (要件 6 の tombstone)。
 *
 * 既に立っていれば時刻を動かさない。「いつ消えたか」は最初に気付いた時点が正しく、
 * 閲覧のたびに更新すると意味を失う。
 */
export async function markGistDeleted(
  db: D1Database,
  id: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE sketches SET gist_deleted_at = ?, revision_checked_at = ?
        WHERE id = ? AND gist_deleted_at IS NULL`
    )
    .bind(now, now, id)
    .run();
}
