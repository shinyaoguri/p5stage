/**
 * 作品メタデータの読み書き (D1)。
 *
 * 所有者の確認はここで一緒にやる。「引いてから呼び出し側で持ち主を比べる」形にすると、
 * 比べ忘れた口が 1 つでもあれば他人の作品を書き換えられてしまうため、
 * **更新系は必ず owner_id を条件に含める**。
 */

import { generateSketchId } from "./id";
import type { Sketch, SketchInput, SketchPatch, Visibility } from "./sketch";

interface SketchRow {
  readonly id: string;
  readonly owner_id: number;
  readonly gist_id: string | null;
  readonly title: string;
  readonly description: string;
  readonly visibility: string;
  readonly created_at: number;
  readonly updated_at: number;
}

const COLUMNS = `id, owner_id, gist_id, title, description, visibility,
                 created_at, updated_at`;

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
 * Gist を紐付ける (2-3 で使う)。
 *
 * 既に紐付いている作品は上書きしない。付け替えは detach を経由させたいので、
 * ここは「まだ無いときだけ書く」に限る。
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
