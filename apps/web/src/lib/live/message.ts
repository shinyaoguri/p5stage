/**
 * 同期配信で交わすメッセージ (Phase 4-2 / ADR 0017)。
 *
 * `packages/shared/src/protocol.ts` (本体 ⇄ ランナー) と違って、これは**本体の中**
 * だけの取り決め — サーバ (Durable Object) と、作品ページで動くクライアントの間。
 * そのため shared には置かず、サーバとクライアントの両方から引ける純ロジックとして
 * ここに置く (`save-panel.ts` が `lib/sketches/content.ts` を引くのと同じ作法)。
 *
 * 流すのは**リビジョン SHA だけ**。中身は D1 のポインタ → R2 の不変オブジェクトで
 * 配る道が既にあり (ADR 0011)、DO に他者のコードを溜める理由が無い。
 */

import { isRevisionSha } from "../sketches/revision-view";

/**
 * 生存確認の往復。
 *
 * この 2 つは Durable Object の `setWebSocketAutoResponse` に登録するので、
 * **DO を起こさずに返る** (wall-clock を消費しないので duration 課金も無い —
 * ADR 0017)。中間プロキシがアイドル接続を切る環境で、再接続の往復より安く保つ。
 */
export const LIVE_PING = "ping";
export const LIVE_PONG = "pong";

/**
 * 「購読は受け付けられない」を伝える close code (作品あたりの上限超過)。
 *
 * 4000-4999 はアプリケーション用。**これを区別できないと、クライアントは
 * 混雑と障害を同じに扱って再接続を投げ続ける**ことになる。
 */
export const LIVE_BUSY_CODE = 4001;

/** 版が進んだ。閲覧側はこれを受けて中身を取り直す。 */
export interface RevisionNotice {
  readonly type: "revision";
  readonly revision: string;
}

/** 配る形に整える。 */
export function revisionNotice(revision: string): string {
  const notice: RevisionNotice = { type: "revision", revision };
  return JSON.stringify(notice);
}

/**
 * 受信データを読み取る。妥当でなければ null。
 *
 * 送り主は自分たちのサーバだが、**受けた値はそのまま次の要求の URL に入る**ので
 * 形を確かめる。`isRevisionSha` は作品ページの `?rev=` と同じ足切りで、ここを
 * 通さないと `/api/sketches/<id>/revisions/<なんでも>` を組ませる口になる。
 */
export function parseLiveMessage(data: unknown): RevisionNotice | null {
  if (typeof data !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) return null;
  const { type, revision } = value as { type?: unknown; revision?: unknown };
  if (type !== "revision") return null;
  if (typeof revision !== "string" || !isRevisionSha(revision)) return null;

  return { type: "revision", revision };
}
