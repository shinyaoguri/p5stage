/**
 * アセット台帳の読み書き (D1)。
 *
 * 数えるのは R2 ではなくここ。実測で数えると、消し損ねた blob や書き込みの途中経過が
 * そのまま利用者の残り容量に化ける (p5.js Web Editor の既知問題)。**台帳を正本にして、
 * R2 は台帳の指す先を置くだけ**にする (ADR 0003)。
 */

import {
  DEFAULT_ASSET_QUOTA_BYTES,
  DEFAULT_MAX_ASSET_BYTES,
  type AssetMime,
} from "@p5stage/shared";

import type { AssetBlob, AssetUsage } from "./asset";

interface BlobRow {
  readonly sha256: string;
  readonly size: number;
  readonly mime: string;
  readonly created_at: number;
}

interface UsageRow {
  readonly bytes: number;
  readonly quota_bytes: number;
  readonly max_asset_bytes: number;
}

function toBlob(row: BlobRow): AssetBlob {
  return {
    sha256: row.sha256,
    size: row.size,
    // allowlist を通ったものだけが入る列なので、ここでの絞り込みは型を合わせるためだけ。
    mime: row.mime as AssetMime,
    createdAt: row.created_at,
  };
}

/** blob が既にあるか。あれば**転送を省ける** (ADR 0003 の dedup)。 */
export async function findBlob(
  db: D1Database,
  sha256: string
): Promise<AssetBlob | null> {
  const row = await db
    .prepare(
      `SELECT sha256, size, mime, created_at FROM blobs WHERE sha256 = ?`
    )
    .bind(sha256)
    .first<BlobRow>();

  return row === null ? null : toBlob(row);
}

/**
 * 使用量と上限を 1 回で引く。
 *
 * 上限はユーザー行が持つ設定値 (要件 3.3)。合計は台帳の SUM で、
 * **同じ blob を 2 人が持ち込めば 2 人とも満額計上される** (ADR 0003)。
 */
export async function assetUsage(
  db: D1Database,
  userId: number
): Promise<AssetUsage> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(b.size)
                     FROM user_blobs ub
                     JOIN blobs b ON b.sha256 = ub.sha256
                    WHERE ub.user_id = u.id), 0) AS bytes,
         u.asset_quota_bytes AS quota_bytes,
         u.max_asset_bytes AS max_asset_bytes
       FROM users u
      WHERE u.id = ?`
    )
    .bind(userId)
    .first<UsageRow>();

  // セッションがある以上ユーザー行はあるはずだが、無いときに上限を無制限と
  // 解釈させないため、既定値へ倒す。
  if (row === null) {
    return {
      bytes: 0,
      quotaBytes: DEFAULT_ASSET_QUOTA_BYTES,
      maxAssetBytes: DEFAULT_MAX_ASSET_BYTES,
    };
  }

  return {
    bytes: row.bytes,
    quotaBytes: row.quota_bytes,
    maxAssetBytes: row.max_asset_bytes,
  };
}

/** その人に既に計上されているか。二重に数えないための判定。 */
export async function hasClaim(
  db: D1Database,
  userId: number,
  sha256: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM user_blobs WHERE user_id = ? AND sha256 = ?`
    )
    .bind(userId, sha256)
    .first<{ readonly found: number }>();

  return row !== null;
}

/** 既にある blob を自分にも計上する。二度目以降は何も起きない。 */
export async function claimBlob(
  db: D1Database,
  userId: number,
  sha256: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_blobs (user_id, sha256, created_at)
       VALUES (?, ?, ?)`
    )
    .bind(userId, sha256, now)
    .run();
}

/**
 * 受け取った blob を台帳に載せ、持ち込んだ人に計上する。
 *
 * blob 側を `OR IGNORE` にするのは、**同じ中身を別の人が同時に上げても衝突させない**
 * ため。中身が同じなら行の内容も同じなので、先に入った方を残して構わない。
 */
export async function recordBlob(
  db: D1Database,
  userId: number,
  blob: AssetBlob
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(blob.sha256, blob.size, blob.mime, blob.createdAt),
    db
      .prepare(
        `INSERT OR IGNORE INTO user_blobs (user_id, sha256, created_at)
         VALUES (?, ?, ?)`
      )
      .bind(userId, blob.sha256, blob.createdAt),
  ]);
}

/**
 * その人の所有を手放す。持っていなければ false (3-4b)。
 *
 * 消えるのは `user_blobs` の 1 行だけで、**`blobs` と R2 の実体には触らない**。
 * 同じ中身を別の人も持ち込んでいることがあり、公開済みのリビジョンが参照して
 * いることもある (ADR 0003 の「公開済みリビジョンが参照する blob は原則削除
 * しない」)。最後の所有者が手放した blob を即消すと、閲覧中の作品が理由も無く
 * 壊れる。孤児の回収は参照カウント + 猶予期間で 3-5 が受け持つ。
 */
export async function releaseBlob(
  db: D1Database,
  userId: number,
  sha256: string
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM user_blobs WHERE user_id = ? AND sha256 = ?`)
    .bind(userId, sha256)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * 1 回の問い合わせに載せる sha256 の数。
 *
 * D1 は 1 文への束縛を 100 個までしか受け付けないので、超える分は分けて引く。
 * 上限ぎりぎりに寄せず、ユーザー ID の分を足しても余る幅にしてある。
 */
const DIGEST_CHUNK = 90;

/**
 * 参照しようとしている blob のうち、その人に計上されていないものを返す (3-2)。
 *
 * マニフェストが指せるのは**自分が持ち込んだ blob だけ**。sha256 さえ書けば他人の
 * blob を参照できる形にすると、クォータを一切使わずに作品を作れてしまい、
 * 「所有で数える」(ADR 0003 の補足) が上限として働かなくなる。他人のアセットを
 * 持ち込む道はフォーク (Phase 4) で、そこでは `user_blobs` に行が増える。
 */
export async function unclaimedDigests(
  db: D1Database,
  userId: number,
  digests: readonly string[]
): Promise<string[]> {
  const claimed = new Set<string>();

  for (let index = 0; index < digests.length; index += DIGEST_CHUNK) {
    const chunk = digests.slice(index, index + DIGEST_CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT sha256 FROM user_blobs
          WHERE user_id = ? AND sha256 IN (${placeholders})`
      )
      .bind(userId, ...chunk)
      .all<{ readonly sha256: string }>();

    for (const row of results) claimed.add(row.sha256);
  }

  return digests.filter((digest) => !claimed.has(digest));
}

/**
 * 台帳にある blob のサイズを引く (Phase 4-3 のフォーク)。
 *
 * フォークは**他人の blob を自分に計上する**唯一の経路で、計上の前に 2 つを
 * 確かめる必要がある — 指されている実体が台帳にあるか、そして合計がクォータに
 * 収まるか。両方をこの 1 回で賄う。
 *
 * **返らなかった sha256 は台帳に無い**。元の作品のマニフェストが壊れている
 * (手で書いた・実体が回収された) ということなので、呼び出し側はそこで断る。
 */
export async function blobSizes(
  db: D1Database,
  digests: readonly string[]
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();

  for (let index = 0; index < digests.length; index += DIGEST_CHUNK) {
    const chunk = digests.slice(index, index + DIGEST_CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT sha256, size FROM blobs WHERE sha256 IN (${placeholders})`
      )
      .bind(...chunk)
      .all<{ readonly sha256: string; readonly size: number }>();

    for (const row of results) sizes.set(row.sha256, row.size);
  }

  return sizes;
}

/**
 * 1 回の `batch` に載せる文の数。
 *
 * Gist は 300 ファイルまで持てるので、マニフェストが指す blob も同じ桁になりうる。
 * 1 文ずつ束縛を持つので `DIGEST_CHUNK` の制約は掛からないが、1 回の往復に
 * 際限なく積むのは避ける。
 */
const REF_CHUNK = 50;

/**
 * 既にある blob をまとめて自分に計上する (Phase 4-3 のフォーク)。
 *
 * `claimBlob` を並べたのと同じことをするが、フォークは 1 回で数十件を持ち込む
 * ので `batch` に寄せる。**作品の行を作るより先に呼ぶ** — 途中で落ちたときに
 * 残るのが「余計に計上された blob」(3-4b の手放しで戻せる) か「所有していない
 * アセットを参照する保存できない作品」(利用者には直せない) かの違いになる。
 */
export async function claimBlobs(
  db: D1Database,
  userId: number,
  digests: readonly string[],
  now: number
): Promise<void> {
  for (let index = 0; index < digests.length; index += REF_CHUNK) {
    const chunk = digests.slice(index, index + REF_CHUNK);
    await db.batch(
      chunk.map((sha256) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO user_blobs (user_id, sha256, created_at)
             VALUES (?, ?, ?)`
          )
          .bind(userId, sha256, now)
      )
    );
  }
}

/**
 * そのリビジョンが参照する blob を台帳に載せる (3-5a)。
 *
 * 呼ぶのは**中身を R2 へ書けた後**だけ (`publishRevision`)。書けていないリビジョンは
 * 配られないので、回収から守る理由も無い。
 *
 * 二度目以降は何も起きない (保存の再試行や閲覧時の fill で同じ組が来る)。
 * 参照を**消す口は無い**: 過去リビジョンは R2 に残り続け、いつでも配りうる。
 */
export async function recordRefs(
  db: D1Database,
  gistId: string,
  revision: string,
  digests: readonly string[],
  now: number
): Promise<void> {
  for (let index = 0; index < digests.length; index += REF_CHUNK) {
    const chunk = digests.slice(index, index + REF_CHUNK);
    await db.batch(
      chunk.map((sha256) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO blob_refs (gist_id, revision, sha256, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .bind(gistId, revision, sha256, now)
      )
    );
  }
}

/** 参照している作品を指す最小の情報。文言に出す分だけ。 */
export interface RefererSketch {
  readonly id: string;
  readonly title: string;
}

/**
 * その人の作品のうち、**今配信しているリビジョン**がこの blob を参照しているものを
 * 引く (3-5a)。手放してよいかの判断はこれで決まる。
 *
 * **過去のリビジョンは見ない。** 所有を手放しても実体は残り、公開済みのリビジョンは
 * そのまま配られ続ける (配信 `/a/<sha256>/<name>` は D1 を引かない)。手放して実際に
 * 壊れるのは**次の保存でマニフェストが断られる**ところだけ (3-2) なので、判断の
 * 基準になるのは「次に保存される中身」= 今のリビジョンに限られる。過去まで数えると、
 * 一度でも使った実体は作品から外した後も永久に手放せず、クォータが空かなくなる。
 *
 * 過去リビジョンが参照する実体を守るのは回収側 (3-5b) の仕事で、あちらは
 * `blob_refs` を丸ごと見る。**同じ台帳を、こちらは今の断面で、あちらは全期間で読む。**
 *
 * **他人の作品は数えない。** 同じ中身を別の人が持ち込んでいれば相手の `user_blobs`
 * にも行があり、こちらが所有を手放しても相手の参照は生きたまま。他人の使用を理由に
 * 自分のクォータを縛るのは筋が違う。
 *
 * 切り離した作品も出てこない (`detachGist` が `gist_id` と `current_revision` を
 * 両方落とすので、結合が成立しない)。その Gist はもうその作品の正本ではない。
 */
export async function sketchesUsingBlob(
  db: D1Database,
  userId: number,
  sha256: string,
  limit: number
): Promise<RefererSketch[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.title
         FROM sketches s
         JOIN blob_refs r
           ON r.gist_id = s.gist_id AND r.revision = s.current_revision
        WHERE r.sha256 = ? AND s.owner_id = ?
        ORDER BY s.updated_at DESC
        LIMIT ?`
    )
    .bind(sha256, userId, limit)
    .all<RefererSketch>();

  return results;
}

/**
 * 孤児の条件 (3-5b)。**誰にも計上されず、どのリビジョンからも参照されていない。**
 *
 * 起点は必ず `blobs`。参照は**全期間**を見る — 過去リビジョンは R2 に残り、いつでも
 * 配りうるので、今配信していないという理由で消してはいけない (手放しの判断
 * `sketchesUsingBlob` が今の断面だけを見るのと対になる)。
 *
 * 逆に、実体の無い sha256 を指す `blob_refs` の行 (利用者が手で書いたマニフェスト —
 * 3-5a) は放っておいてよい。`blobs` を起点に引く限り出てこない。
 */
const ORPHAN_CONDITION = `NOT EXISTS (SELECT 1 FROM user_blobs ub WHERE ub.sha256 = blobs.sha256)
   AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.sha256 = blobs.sha256)`;

/**
 * 孤児に印を立てる。立てた数を返す (3-5b)。
 *
 * 印の時刻から猶予を数えるので、**気付いた時刻を記録する**のがこの操作の意味。
 * 既に印のあるものは触らない (`orphaned_at IS NULL` の条件) — 触ると猶予が
 * 毎回振り出しに戻り、いつまでも回収されない。
 */
export async function markOrphanBlobs(
  db: D1Database,
  now: number,
  limit: number
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE blobs SET orphaned_at = ?
        WHERE sha256 IN (
          SELECT sha256 FROM blobs
           WHERE orphaned_at IS NULL AND ${ORPHAN_CONDITION}
           LIMIT ?
        )`
    )
    .bind(now, limit)
    .run();

  return result.meta.changes ?? 0;
}

/**
 * 所有か参照が戻った blob の印を消す。消した数を返す (3-5b)。
 *
 * 手放した実体をもう一度持ち込む道は開いている (同じ中身なら転送も要らない — 3-1)。
 * 猶予の間に戻ってきたものを回収するのは筋が通らないので、**回収の前に必ずここを
 * 通す**。件数の上限を持たないのは、印の付いた行が部分インデックスで引ける少数で、
 * かつ取りこぼすと消してはいけないものを消すため。
 */
export async function unmarkRevivedBlobs(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE blobs SET orphaned_at = NULL
        WHERE orphaned_at IS NOT NULL AND NOT (${ORPHAN_CONDITION})`
    )
    .run();

  return result.meta.changes ?? 0;
}

/** 猶予を過ぎた孤児の sha256 (3-5b)。`cutoff` はこれ以前に印が付いたもの。 */
export async function dueOrphanBlobs(
  db: D1Database,
  cutoff: number,
  limit: number
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT sha256 FROM blobs
        WHERE orphaned_at IS NOT NULL AND orphaned_at <= ?
        ORDER BY orphaned_at
        LIMIT ?`
    )
    .bind(cutoff, limit)
    .all<{ readonly sha256: string }>();

  return results.map((row) => row.sha256);
}

/**
 * 台帳から blob を落とす。落とせたら true (3-5b)。
 *
 * **孤児の条件をもう一度確かめてから消す。** 対象を引いてから実体を消すまでの間に
 * 所有や参照が戻ることはある (claim は猶予中の blob も受け付ける)。条件を付けずに
 * 消すと、その行を指す `user_blobs` が外部キーの参照先を失う。
 *
 * 呼ぶのは **R2 の実体を消した後**。逆にすると台帳から消えて実体だけが残り、
 * 回収は `blobs` を起点に引くので二度と見つけられなくなる。
 */
export async function forgetBlob(
  db: D1Database,
  sha256: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM blobs
        WHERE sha256 = ? AND orphaned_at IS NOT NULL AND ${ORPHAN_CONDITION}`
    )
    .bind(sha256)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/** バッチが持ち越す状態 (`gc_state`) を読む。無ければ null。 */
export async function readGcState(
  db: D1Database,
  key: string
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM gc_state WHERE key = ?`)
    .bind(key)
    .first<{ readonly value: string }>();

  return row === null ? null : row.value;
}

/** バッチが持ち越す状態を書く。 */
export async function writeGcState(
  db: D1Database,
  key: string,
  value: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO gc_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, value, now)
    .run();
}

/** 自分が持ち込んだ blob を新しい順に引く (管理 UI は 3-4)。 */
export async function listBlobsByOwner(
  db: D1Database,
  userId: number,
  limit: number
): Promise<AssetBlob[]> {
  const { results } = await db
    .prepare(
      `SELECT b.sha256, b.size, b.mime, ub.created_at
         FROM user_blobs ub
         JOIN blobs b ON b.sha256 = ub.sha256
        WHERE ub.user_id = ?
        ORDER BY ub.created_at DESC
        LIMIT ?`
    )
    .bind(userId, limit)
    .all<BlobRow>();

  return results.map(toBlob);
}
