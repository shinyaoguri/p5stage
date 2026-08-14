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
