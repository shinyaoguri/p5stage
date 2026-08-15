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
  SketchLineage,
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
  readonly forked_from_sketch_id: string | null;
  readonly forked_from_revision: string | null;
  readonly thumbnail_revision: string | null;
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
  "forked_from_sketch_id",
  "forked_from_revision",
  "thumbnail_revision",
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
    forkedFromSketchId: row.forked_from_sketch_id,
    forkedFromRevision: row.forked_from_revision,
    thumbnailRevision: row.thumbnail_revision,
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
    forkedFromSketchId: null,
    forkedFromRevision: null,
    thumbnailRevision: null,
  };
}

/**
 * 既にある Gist を正本として作品を作る (取り込み — Phase 2-6)。
 *
 * `createSketch` + `attachGist` の 2 手ではなく 1 文にする。間に挟まる隙が無くなるので、
 * **Gist の付いていない作品が取り込みの失敗跡として残らない**。
 *
 * 同じ Gist が別の作品に付いていれば `gist_id` の UNIQUE 制約で落ちる。呼び出し側は
 * それを先に引いて (`getSketchByGistId`) 案内に変える。
 *
 * フォーク (Phase 4-3) も同じ形で収まる。あちらは GitHub 側に新しい Gist ができて
 * いる点だけが違い、「既にある Gist を正本として作品を作る」ことに変わりはない。
 * 系譜を持つのはそのときだけなので `lineage` は省略できる。
 */
export async function createSketchFromGist(
  db: D1Database,
  ownerId: number,
  input: SketchInput,
  gistId: string,
  now: number,
  lineage: SketchLineage | null = null
): Promise<Sketch> {
  const id = generateSketchId();
  const forkedFromSketchId = lineage?.sketchId ?? null;
  const forkedFromRevision = lineage?.revision ?? null;

  await db
    .prepare(
      `INSERT INTO sketches
         (id, owner_id, gist_id, title, description, visibility, created_at, updated_at,
          forked_from_sketch_id, forked_from_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      ownerId,
      gistId,
      input.title,
      input.description,
      input.visibility,
      now,
      now,
      forkedFromSketchId,
      forkedFromRevision
    )
    .run();

  return {
    id,
    ownerId,
    gistId,
    title: input.title,
    description: input.description,
    visibility: input.visibility,
    createdAt: now,
    updatedAt: now,
    currentRevision: null,
    revisionEtag: null,
    revisionCheckedAt: null,
    gistDeletedAt: null,
    forkedFromSketchId,
    forkedFromRevision,
    thumbnailRevision: null,
  };
}

/**
 * Gist から作品を引く。同じ Gist を二度取り込もうとしたときの案内に使う。
 *
 * 所有者で絞らない。**他人が既に取り込んでいる Gist**も見えないと、UNIQUE 制約の
 * 違反として落ちるだけで理由を返せない。
 */
export async function getSketchByGistId(
  db: D1Database,
  gistId: string
): Promise<Sketch | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM sketches WHERE gist_id = ?`)
    .bind(gistId)
    .first<SketchRow>();

  return row === null ? null : toSketch(row);
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

/**
 * 公開作品を新しい順に、作者ごと引く (Phase 5 の新着ギャラリー)。
 *
 * `visibility` を先頭に置いた `sketches_public` インデックス (0002) に乗る形。
 * **開けない作品は並べない** — 未保存 (`current_revision IS NULL`) と、GitHub 側で
 * 消された印の付いたもの (`gist_deleted_at`) は、開いても中身が出ないので
 * 一覧に見せても 404 の入口が増えるだけ。
 */
export async function listPublicSketches(
  db: D1Database,
  limit: number
): Promise<SketchWithOwner[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SKETCH_COLUMNS},
              u.login AS owner_login, u.avatar_url AS owner_avatar_url
         FROM sketches s
         JOIN users u ON u.id = s.owner_id
        WHERE s.visibility = 'public'
          AND s.current_revision IS NOT NULL
          AND s.gist_deleted_at IS NULL
        ORDER BY s.updated_at DESC
        LIMIT ?`
    )
    .bind(limit)
    .all<SketchWithOwnerRow>();

  return results.map((row) => ({
    ...toSketch(row),
    ownerLogin: row.owner_login,
    ownerAvatarUrl: row.owner_avatar_url,
  }));
}

/**
 * ある作者の公開作品を新しい順に (Phase 5 のユーザーページ)。
 *
 * 選定は `listPublicSketches` と同じで、絞りに作者が加わるだけ。`owner_id` を
 * 先頭に置いた `sketches_owner` インデックス (0002) に乗る。
 *
 * **本人が自分のページを見ていても限定公開は出さない。** 閲覧者ごとに中身の違う
 * HTML を作ると、共有キャッシュ (`s-maxage=60`) 越しに他人へ配られる。自分の作品の
 * 一覧はエディタ側が持っている (`listSketchesByOwner`)。
 */
export async function listPublicSketchesByOwner(
  db: D1Database,
  ownerId: number,
  limit: number
): Promise<SketchWithOwner[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SKETCH_COLUMNS},
              u.login AS owner_login, u.avatar_url AS owner_avatar_url
         FROM sketches s
         JOIN users u ON u.id = s.owner_id
        WHERE s.owner_id = ?
          AND s.visibility = 'public'
          AND s.current_revision IS NOT NULL
          AND s.gist_deleted_at IS NULL
        ORDER BY s.updated_at DESC
        LIMIT ?`
    )
    .bind(ownerId, limit)
    .all<SketchWithOwnerRow>();

  return results.map((row) => ({
    ...toSketch(row),
    ownerLogin: row.owner_login,
    ownerAvatarUrl: row.owner_avatar_url,
  }));
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
 * 作品を Gist から切り離す (Phase 2-6 / ADR 0012)。
 *
 * **配信のポインタも一緒に落とす**。切り離した中身を閲覧者に配り続けると、
 * 「切り離した」が閲覧者から見て何も起きていないのと同じになる。作品ページは
 * 「まだ保存されていません」に戻り、次の保存で新しい Gist ができて復活する。
 *
 * tombstone も外す。「作者が GitHub 側で消した」という事実は、その Gist に付いて
 * いたもので、切り離した後の作品には掛からない。
 *
 * サムネイルの指す版も落とす。R2 のキーは `thumbs/<gistId>/<revision>.png` なので
 * (ADR 0019)、Gist が外れた時点でその版はもうこの作品の絵ではない。
 *
 * GitHub には何もしない。利用者の Gist は利用者のもので、こちらが消す筋合いは無い。
 */
export async function detachGist(
  db: D1Database,
  id: string,
  ownerId: number,
  now: number
): Promise<Sketch | null> {
  const result = await db
    .prepare(
      `UPDATE sketches
          SET gist_id = NULL, current_revision = NULL, revision_etag = NULL,
              revision_checked_at = NULL, gist_deleted_at = NULL,
              thumbnail_revision = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND gist_id IS NOT NULL`
    )
    .bind(now, id, ownerId)
    .run();

  // 0 行なら「無い」「他人のもの」「既に切り離されている」。呼び出し側の扱いは同じ。
  if (result.meta.changes === 0) return null;
  return getSketch(db, id);
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

/**
 * サムネイルが撮れている版を記す (Phase 4-4 / ADR 0019)。
 *
 * 所有者で絞る。**これは持ち主の操作の結果**で、書けるのは自分の作品の絵を
 * 上げた本人だけ (`setCurrentRevision` が絞らないのは、あちらが GitHub にある
 * 事実の写しで閲覧経路からも書かれるため)。
 *
 * `updated_at` は動かさない。一覧の並びは「最後に手を入れた順」であってほしく、
 * 保存に付いてくる撮影で順番が動くと、中身が変わっていない作品が上がってくる。
 */
export async function setThumbnailRevision(
  db: D1Database,
  id: string,
  ownerId: number,
  revision: string
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE sketches SET thumbnail_revision = ? WHERE id = ? AND owner_id = ?"
    )
    .bind(revision, id, ownerId)
    .run();

  return result.meta.changes > 0;
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

/** 作品に付いているタグ (Phase 5)。作者が並べた順に返す。 */
export async function listTagsForSketch(
  db: D1Database,
  sketchId: string
): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT tag FROM sketch_tags WHERE sketch_id = ? ORDER BY position"
    )
    .bind(sketchId)
    .all<{ tag: string }>();

  return results.map((row) => row.tag);
}

/**
 * タグを付け替える (Phase 5)。持ち主でなければ何も起きず false。
 *
 * **差分ではなく全置換。** タグは 5 個までの短い並びで、順番も持ち物のうちなので、
 * 「どれを消してどれを足すか」を送らせるより送り直す方が食い違いが起きない。
 *
 * 1 度の `batch()` にまとめる (D1 の batch はトランザクション)。**途中で落ちると
 * タグが消えただけの状態が残る**のを避けるため、消す側と足す側を分けない。
 * 所有の確認も SQL の中でやる — 引いてから比べる形にすると、比べ忘れた口が 1 つでも
 * あれば他人の作品を書き換えられる (この表は `owner_id` を持たないので、
 * 毎回 `sketches` を経由して絞る)。
 *
 * `updated_at` は進める。タグ付けは作者が作品に手を入れた出来事で、一覧の並びが
 * それで動くのは筋が通っている (絵を撮り直しただけの `setThumbnailRevision` とは違う)。
 */
export async function replaceTags(
  db: D1Database,
  sketchId: string,
  ownerId: number,
  tags: readonly string[],
  now: number
): Promise<boolean> {
  const results = await db.batch([
    // 1 文目の changes が「持ち主だったか」を兼ねる。タグが 0 個のときも
    // 答えが出るよう、数を数えるのは DELETE ではなくこちら。
    db
      .prepare(
        "UPDATE sketches SET updated_at = ? WHERE id = ? AND owner_id = ?"
      )
      .bind(now, sketchId, ownerId),
    db
      .prepare(
        `DELETE FROM sketch_tags
          WHERE sketch_id IN (SELECT id FROM sketches WHERE id = ? AND owner_id = ?)`
      )
      .bind(sketchId, ownerId),
    ...tags.map((tag, index) =>
      db
        .prepare(
          `INSERT INTO sketch_tags (sketch_id, tag, position)
             SELECT id, ?, ? FROM sketches WHERE id = ? AND owner_id = ?`
        )
        .bind(tag, index, sketchId, ownerId)
    ),
  ]);

  return (results[0]?.meta.changes ?? 0) > 0;
}

/**
 * 親のタグを派生へ引き継ぐ (Phase 4-3 のフォーク)。
 *
 * 派生は親の主題を引き継いでいるのが普通で、付け直しから始めさせる理由が無い。
 * 要らなければ作者が外せる。呼び出すのは作品を作った直後なので、所有の確認は
 * 呼び出し側が済ませている。
 */
export async function copyTags(
  db: D1Database,
  fromSketchId: string,
  toSketchId: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sketch_tags (sketch_id, tag, position)
         SELECT ?, tag, position FROM sketch_tags WHERE sketch_id = ?`
    )
    .bind(toSketchId, fromSketchId)
    .run();
}

/**
 * そのタグが付いた公開作品を新しい順に (Phase 5 のタグ別一覧)。
 *
 * 選定は `listPublicSketches` と同条件 (公開・書き出し済み・tombstone でない) に
 * タグの結合が加わるだけ。**限定公開はタグを持てるが一覧には出ない** — 出せば
 * 「URL を知る人だけ」の前提が崩れる。
 */
export async function listPublicSketchesByTag(
  db: D1Database,
  tag: string,
  limit: number
): Promise<SketchWithOwner[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SKETCH_COLUMNS},
              u.login AS owner_login, u.avatar_url AS owner_avatar_url
         FROM sketch_tags t
         JOIN sketches s ON s.id = t.sketch_id
         JOIN users u ON u.id = s.owner_id
        WHERE t.tag = ?
          AND s.visibility = 'public'
          AND s.current_revision IS NOT NULL
          AND s.gist_deleted_at IS NULL
        ORDER BY s.updated_at DESC
        LIMIT ?`
    )
    .bind(tag, limit)
    .all<SketchWithOwnerRow>();

  return results.map((row) => ({
    ...toSketch(row),
    ownerLogin: row.owner_login,
    ownerAvatarUrl: row.owner_avatar_url,
  }));
}
