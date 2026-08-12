/**
 * セッションの読み書き (D1)。
 *
 * cookie の生の値は DB に置かず、SHA-256 を主キーにする。GitHub のアクセストークンは
 * AES-GCM の封筒に入れて格納する (ADR 0009)。ここはその出し入れだけを持ち、
 * 鍵の作り方や封筒の中身は `crypto.ts` の担当。
 */

import type { GitHubViewer } from "../github/oauth";

import {
  generateSessionId,
  hashSessionId,
  openToken,
  sealToken,
  SealedTokenError,
} from "./crypto";
import { SESSION_MAX_AGE_SECONDS } from "./cookie";

/** ログイン中のユーザーと、その人のトークン。 */
export interface ActiveSession {
  readonly user: GitHubViewer;
  /** GitHub API を代理で叩くためのトークン。**ブラウザへは返さない** (ADR 0009)。 */
  readonly token: string;
}

interface SessionRow {
  readonly user_id: number;
  readonly login: string;
  readonly avatar_url: string | null;
  readonly token_ciphertext: ArrayBuffer;
  readonly token_iv: ArrayBuffer;
  readonly expires_at: number;
}

/**
 * セッションを作り、cookie に載せる生の ID を返す。
 *
 * ユーザーは同時に upsert する。GitHub 側で改名・アイコン変更があっても、
 * ログインのたびに追いつく。
 */
export async function createSession(
  db: D1Database,
  key: CryptoKey,
  user: GitHubViewer,
  token: string,
  now: number
): Promise<string> {
  const rawId = generateSessionId();
  const id = await hashSessionId(rawId);
  const sealed = await sealToken(key, token);
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, login, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           login = excluded.login,
           avatar_url = excluded.avatar_url,
           updated_at = excluded.updated_at`
      )
      .bind(user.id, user.login, user.avatarUrl, now, now),
    db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, token_ciphertext, token_iv, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, user.id, sealed.ciphertext, sealed.iv, now, expiresAt),
  ]);

  return rawId;
}

/**
 * cookie の値からセッションを引く。無効なら null。
 *
 * 「無効」は失効・不在・封筒が開かない (鍵のロテート or 改竄) を区別しない。
 * 呼び出し側の扱いはどれも「ログインしていない」で同じになる。
 */
export async function readSession(
  db: D1Database,
  key: CryptoKey,
  rawId: string,
  now: number
): Promise<ActiveSession | null> {
  const id = await hashSessionId(rawId);

  const row = await db
    .prepare(
      `SELECT s.user_id, s.token_ciphertext, s.token_iv, s.expires_at,
              u.login, u.avatar_url
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .bind(id)
    .first<SessionRow>();

  if (row === null) return null;

  if (row.expires_at <= now) {
    // 期限切れはその場で捨てる。掃除のバッチを待たない。
    await deleteSessionByHash(db, id);
    return null;
  }

  try {
    const token = await openToken(key, {
      ciphertext: new Uint8Array(row.token_ciphertext),
      iv: new Uint8Array(row.token_iv),
    });
    return {
      user: {
        id: row.user_id,
        login: row.login,
        avatarUrl: row.avatar_url,
      },
      token,
    };
  } catch (error) {
    if (error instanceof SealedTokenError) {
      // 開かない封筒は二度と開かない。残しても意味が無いので消す。
      await deleteSessionByHash(db, id);
      return null;
    }
    throw error;
  }
}

/** ログアウト。cookie の値から引いて消す。 */
export async function deleteSession(
  db: D1Database,
  rawId: string
): Promise<void> {
  await deleteSessionByHash(db, await hashSessionId(rawId));
}

async function deleteSessionByHash(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}
