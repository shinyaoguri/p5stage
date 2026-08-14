/**
 * 作品 1 件ぶんの同期チャネル (Phase 4-2 / ADR 0017)。
 *
 * 作者が版を進めたことを、その作品を開いている閲覧者へ配るだけの中継器。
 * 粒度は作品 1 件 = DO 1 つ (`idFromName(sketchId)`)。
 *
 * ## 状態を持たない
 *
 * Hibernation WebSocket API を使うと、接続を保ったまま DO をメモリから追い出せる
 * (= 繋いでいる時間が課金されない)。**その代わり hibernate から戻ると
 * constructor が再実行され、インスタンス変数は消えている。**
 *
 * だからここには「購読者の集合」も「最後に流した版」も持たせない。
 *
 * - 購読者は `ctx.getWebSockets()` が hibernate をまたいで返す
 * - 再接続の間に進んだ版は、**クライアントが繋ぎ直した直後に現在の版を 1 回引いて**
 *   埋める (`/api/sketches/:id/head`)。DO に覚えさせるより、既に真実を持っている
 *   D1 に聞く方が確かで、hibernate の制約とも噛み合う
 *
 * `ctx.storage` も使わない。SQLite backend を宣言しているのは、Workers Free plan の
 * Durable Objects が SQLite backend のものに限られるため (ADR 0017)。
 */

import { DurableObject } from "cloudflare:workers";

import {
  LIVE_BUSY_CODE,
  LIVE_PING,
  LIVE_PONG,
  revisionNotice,
} from "./message";

/**
 * 1 作品あたりの同時購読数の上限。
 *
 * 超えても**閲覧そのものは壊さない** — 作品ページは普通に見えて、追従だけしない。
 * 上限を設けるのは、1 つの作品がバズったときの挙動を自分で決めておくため
 * (Cloudflare 側の限界に当たって何が起きるかは、こちらから見えない)。
 */
export const MAX_SUBSCRIBERS = 1000;

export class SketchChannel extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // 生存確認は DO を起こさずに返す。**hibernate 中でも応答が返る**ので、
    // ここを通す限り ping は duration を消費しない (ADR 0017)。
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG)
    );
  }

  /**
   * 購読をつなぐ。上限を超えていたら、つないだ直後に理由を付けて閉じる。
   *
   * 101 を返さずに 503 で断つ形にしないのは、**ブラウザからは upgrade の
   * ステータスが読めない**ため。それだと混雑と障害を区別できず、クライアントは
   * 再接続を投げ続ける (それ自体が要求数を食う)。close code なら読める。
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(null, { status: 426 });
    }

    // 添字で取り出す。`Object.values` だと要素が `WebSocket | undefined` になり、
    // 2 本あることが型から落ちる。
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // `accept()` (標準 API) ではなくこちら。標準 API の WebSocket を持つ DO は
    // hibernate できなくなり、接続時間がそのまま課金される。
    this.ctx.acceptWebSocket(server);

    if (this.ctx.getWebSockets().length > MAX_SUBSCRIBERS) {
      server.close(LIVE_BUSY_CODE, "busy");
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * 版が進んだことを配る。
   *
   * 送信 (outgoing) メッセージに課金は無いので、購読者が何人いても費用は
   * 「この呼び出しの実行時間」だけ (ADR 0017)。
   *
   * 個々の送信は失敗しても無視する。**閉じかけの接続が 1 つあるだけで、
   * 他の閲覧者への配信を落とすわけにはいかない**。落ちた接続は
   * `webSocketClose` / `webSocketError` の後に一覧から消える。
   */
  publish(revision: string): void {
    const notice = revisionNotice(revision);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(notice);
      } catch {
        // この接続はもう使えない。次の呼び出しでは一覧に現れない。
      }
    }
  }

  /**
   * 閲覧者から来たメッセージ。**受け取るものは何も無い。**
   *
   * 生存確認は `setWebSocketAutoResponse` が拾うのでここへは来ない。つまりここへ
   * 届くのは想定外のものだけで、受信は課金対象 (20:1) なので黙って閉じる。
   */
  override webSocketMessage(socket: WebSocket): void {
    socket.close(LIVE_BUSY_CODE, "unexpected message");
  }
}
