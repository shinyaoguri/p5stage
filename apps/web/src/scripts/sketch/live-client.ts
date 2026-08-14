/**
 * 作品ページの同期購読 (Phase 4-2 / ADR 0017)。
 *
 * 受け取るのは**リビジョン SHA だけ**。中身をどう取って画面へ流すかは持たない
 * (それは `sketch-view.ts` の仕事) — ここが持つのは「いつ・どの版へ切り替えるべきか」
 * と、接続を保ち続ける段取り。
 *
 * サーバ側は Durable Object で、hibernate から戻るたびに記憶を失う。つまり
 * **繋ぎ直した瞬間に版が進んでいたことは、あちらからは知らされない**。
 * 開くたびに現在の版を 1 回引いて追いつく (`#catchUp`)。
 */

import {
  LIVE_BUSY_CODE,
  LIVE_PING,
  parseLiveMessage,
} from "../../lib/live/message";

/** 購読の状態。作品ページはこれを `data-live-state` に出す。 */
export type LiveState =
  /** 繋ぎにいっている (最初の接続・切れた後の待ち)。 */
  | "connecting"
  /** 繋がっていて、作者の保存に追従する。 */
  | "live"
  /** もう繋ぎにいかない (混雑・ページを離れた)。 */
  | "off";

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;

/**
 * 生存確認を送る間隔。
 *
 * 中間プロキシがアイドル接続を切る環境で、**切れて繋ぎ直すより ping を送る方が
 * 安い** (サーバ側は `setWebSocketAutoResponse` が返すので Durable Object は
 * 起きない = duration 課金が無い。再接続は 1 回まるごと要求として数えられる)。
 */
export const PING_INTERVAL_MS = 45_000;

/**
 * 次に繋ぎ直すまでの待ち時間。
 *
 * 指数で伸ばして上限で頭打ち。**そこから半分までの幅で散らす** — 同じ瞬間に
 * 切れた閲覧者が揃って戻ってくると、復旧しかけたところをもう一度倒しにいく。
 *
 * `jitter` は 0 以上 1 未満 (呼び出し側が `Math.random()` を渡す。テストのため
 * 引数にしてある)。
 */
export function reconnectDelay(attempt: number, jitter: number): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  return Math.round(base * (0.5 + jitter * 0.5));
}

/** 購読の URL。ページと同じオリジンの ws / wss にする。 */
export function liveUrl(origin: string, sketchId: string): string {
  const url = new URL(
    `/api/sketches/${encodeURIComponent(sketchId)}/live`,
    origin
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/** 今配信している版を尋ねる URL。 */
export function headUrl(sketchId: string): string {
  return `/api/sketches/${encodeURIComponent(sketchId)}/head`;
}

/** 1 つの版の中身を取る URL。 */
export function revisionUrl(sketchId: string, revision: string): string {
  return `/api/sketches/${encodeURIComponent(sketchId)}/revisions/${encodeURIComponent(revision)}`;
}

export interface LiveClientOptions {
  readonly sketchId: string;
  /** 今画面に出ている版。ここから進んだ通知だけが意味を持つ。 */
  readonly revision: string | null;
  /**
   * 版を切り替える。**成功したときだけ resolve する**こと — 失敗を握って
   * resolve すると、切り替えられていない版を「出した」と記録してしまい、
   * 次の通知まで画面が古いまま止まる。
   */
  applyRevision(revision: string): Promise<void>;
  onState?(state: LiveState): void;
}

export class LiveClient {
  readonly #options: LiveClientOptions;
  #socket: WebSocket | null = null;
  #revision: string | null;
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  /** 自分から畳んだ。以降は繋ぎ直さない。 */
  #stopped = false;
  /** 切り替えの最中。着地するまで次を走らせない。 */
  #applying = false;
  /** 切り替えの最中に来た、もっと新しい版。 */
  #queued: string | null = null;

  constructor(options: LiveClientOptions) {
    this.#options = options;
    this.#revision = options.revision;
    this.#connect();
  }

  /** ページを離れる。 */
  dispose(): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#socket?.close();
    this.#socket = null;
    this.#emit("off");
  }

  #connect(): void {
    if (this.#stopped) return;
    this.#emit("connecting");

    const socket = new WebSocket(
      liveUrl(window.location.origin, this.#options.sketchId)
    );
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#attempt = 0;
      this.#emit("live");
      this.#startPing();
      // 繋がっていない間に進んだ版を拾う。**知らせは取りこぼしても、ここで回復する**。
      void this.#catchUp();
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      const message = parseLiveMessage(event.data);
      // 生存確認の応答も、壊れた値もここに来る。どちらも捨てるだけ。
      if (message !== null) this.#accept(message.revision);
    });

    socket.addEventListener("close", (event: CloseEvent) => {
      this.#clearTimers();
      this.#socket = null;
      // 混雑で断られた。繋ぎ直しても同じなので諦める — **作品ページは普通に
      // 見えていて、追従しないだけ**。
      if (event.code === LIVE_BUSY_CODE) {
        this.#emit("off");
        return;
      }
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#emit("connecting");

    const delay = reconnectDelay(this.#attempt, Math.random());
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #startPing(): void {
    this.#pingTimer = setInterval(() => {
      if (this.#socket?.readyState === WebSocket.OPEN) {
        this.#socket.send(LIVE_PING);
      }
    }, PING_INTERVAL_MS);
  }

  #clearTimers(): void {
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    this.#reconnectTimer = null;
    this.#pingTimer = null;
  }

  /**
   * 今の版を尋ねて、進んでいたら追いつく。
   *
   * **答えが返るまでに版が動いていたら捨てる。** 引いている最中に知らせが来る
   * ことがあり、その場合こちらの答えはもう古い。SHA には前後関係が無いので、
   * 遅れて着いた古い答えをそのまま当てると**画面が巻き戻る**。
   */
  async #catchUp(): Promise<void> {
    const before = this.#revision;
    try {
      const response = await fetch(headUrl(this.#options.sketchId));
      if (!response.ok) return;
      const body = (await response.json()) as { revision?: unknown };
      if (typeof body.revision !== "string") return;
      if (this.#revision !== before || this.#applying) return;
      this.#accept(body.revision);
    } catch {
      // 繋がった直後に引けなかっただけ。次の知らせか次の再接続で追いつく。
    }
  }

  /**
   * 版を受け取る。
   *
   * 同じ版は捨てる (開いた直後に自分が出している版が流れてくる)。切り替えの
   * 最中なら覚えておき、着地してから続ける — **並行して走らせると、遅い方の
   * 古い版が後から画面に出る**。
   */
  #accept(revision: string): void {
    if (revision === this.#revision) return;

    if (this.#applying) {
      this.#queued = revision;
      return;
    }
    void this.#apply(revision);
  }

  async #apply(revision: string): Promise<void> {
    this.#applying = true;
    try {
      await this.#options.applyRevision(revision);
      this.#revision = revision;
    } catch {
      // 出せなかった版は覚えない。次の知らせでもう一度来る。
    } finally {
      this.#applying = false;
    }

    const queued = this.#queued;
    this.#queued = null;
    if (queued !== null && queued !== this.#revision) {
      await this.#apply(queued);
    }
  }

  #emit(state: LiveState): void {
    this.#options.onState?.(state);
  }
}
