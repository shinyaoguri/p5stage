/**
 * 同期購読の段取り (Phase 4-2 / ADR 0017)。
 *
 * ここで見るのは、壊れても**静かに追従しなくなるだけ**の判断 — 誰も気付かない
 * 種類の失敗なので、テストで留める価値が高い。
 *
 * - 繋ぎ直した瞬間に版が進んでいたら追いつく (サーバ側は hibernate で記憶を失うため、
 *   知らせは再送されない)
 * - 今出している版と同じ知らせは捨てる
 * - 切り替えの最中に来た知らせを取りこぼさず、かつ**古い版を後から出さない**
 * - 混雑で断られたら繋ぎ直さない (繋ぎ直しても同じで、要求だけが増える)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_BUSY_CODE, revisionNotice } from "../src/lib/live/message";
import {
  LiveClient,
  RECONNECT_MAX_MS,
  headUrl,
  liveUrl,
  reconnectDelay,
  revisionUrl,
  type LiveState,
} from "../src/scripts/sketch/live-client";

const SKETCH_ID = "E2EPublicSketch0";
const CURRENT = "e2e1111111111111111111111111111111111111";
const NEXT = "e2e2222222222222222222222222222222222222";
const LATER = "e2e3333333333333333333333333333333333333";

const ORIGIN = "https://p5stage.test";

/** 制御できる WebSocket。開く・受ける・閉じるをテストから起こす。 */
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = 0;
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: never) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(handler as (event: unknown) => void);
    this.#listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  #emit(type: string, event: unknown): void {
    for (const handler of this.#listeners.get(type) ?? []) handler(event);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.#emit("open", {});
  }

  receive(data: string): void {
    this.#emit("message", { data });
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.#emit("close", { code });
  }
}

/** 直近に作られた接続。 */
function socket(): FakeSocket {
  const last = FakeSocket.instances.at(-1);
  if (last === undefined) throw new Error("接続が作られていません");
  return last;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * 応答の最小形。
 *
 * 本物の `Response` を使わないのは、`json()` の解決に何段のマイクロタスクが
 * 要るかが実装依存になるため。**「待てば済む」形にしておくと、待ち足りない
 * テストが緑のまま通り抜ける** (実際それで取り逃した)。
 */
function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

/** 追いつきの答えが済むところまでマイクロタスクを進める。 */
async function settle(): Promise<void> {
  for (let step = 0; step < 5; step += 1) await Promise.resolve();
}

/** 今の版を答える口。 */
function stubHead(revision: string | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse({ revision })))
  );
}

interface Harness {
  readonly client: LiveClient;
  readonly applied: string[];
  readonly states: LiveState[];
}

function start(
  revision: string | null,
  applyRevision?: (revision: string) => Promise<void>
): Harness {
  const applied: string[] = [];
  const states: LiveState[] = [];
  const client = new LiveClient({
    sketchId: SKETCH_ID,
    revision,
    applyRevision: (next) => {
      applied.push(next);
      return applyRevision?.(next) ?? Promise.resolve();
    },
    onState: (state) => states.push(state),
  });
  return { client, applied, states };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { origin: ORIGIN } });
  stubHead(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("URL の組み立て", () => {
  it("購読は同じオリジンの ws / wss へ向ける", () => {
    expect(liveUrl("https://p5stage.org", SKETCH_ID)).toBe(
      `wss://p5stage.org/api/sketches/${SKETCH_ID}/live`
    );
    expect(liveUrl("http://localhost:8790", SKETCH_ID)).toBe(
      `ws://localhost:8790/api/sketches/${SKETCH_ID}/live`
    );
  });

  it("作品 ID とリビジョンはエスケープする", () => {
    expect(headUrl("a/b")).toBe("/api/sketches/a%2Fb/head");
    expect(revisionUrl("a/b", "../x")).toBe(
      "/api/sketches/a%2Fb/revisions/..%2Fx"
    );
  });
});

describe("reconnectDelay", () => {
  it("指数で伸びて上限で頭打ちになる", () => {
    // ジッタの上端 (1) で見る。
    expect(reconnectDelay(0, 1)).toBe(1000);
    expect(reconnectDelay(1, 1)).toBe(2000);
    expect(reconnectDelay(5, 1)).toBe(
      32_000 > RECONNECT_MAX_MS ? 30_000 : 32_000
    );
    expect(reconnectDelay(20, 1)).toBe(RECONNECT_MAX_MS);
  });

  it("待ち時間を散らす (揃って戻ってこない)", () => {
    // 同じ回数でも、ジッタで基準の半分から満額までの幅に入る。
    expect(reconnectDelay(3, 0)).toBe(4000);
    expect(reconnectDelay(3, 0.999)).toBeGreaterThan(reconnectDelay(3, 0));
    expect(reconnectDelay(3, 0.999)).toBeLessThanOrEqual(8000);
  });
});

describe("LiveClient", () => {
  it("繋がった直後に今の版を引いて、進んでいれば追いつく", async () => {
    // 知らせが飛んだのは繋がっていない間。**あちらは覚えていない**ので、
    // ここで引かないと次の保存まで古いまま止まる。
    stubHead(NEXT);
    const { applied } = start(CURRENT);

    socket().open();

    await vi.waitFor(() => expect(applied).toEqual([NEXT]));
  });

  it("今出している版と同じなら、引いても切り替えない", async () => {
    stubHead(CURRENT);
    const { applied } = start(CURRENT);

    socket().open();
    // 「何も起きない」は待っても確かめられないので、**後から流した別の版が
    // 当たること**で挟む。余計な切り替えがあれば、その手前に混ざって出る。
    socket().receive(revisionNotice(NEXT));

    await vi.waitFor(() => expect(applied).toEqual([NEXT]));
  });

  it("追いつきの答えが遅れて着いても、画面を巻き戻さない", async () => {
    // 引いている最中に知らせが来ると、あとから着く答えはもう古い。SHA に前後関係は
    // 無いので、そのまま当てると新しい版から古い版へ戻ってしまう。
    let answer: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          })
      )
    );

    const { applied } = start(CURRENT);
    socket().open();

    socket().receive(revisionNotice(NEXT));
    await vi.waitFor(() => expect(applied).toEqual([NEXT]));

    // 引いている間に版が動いた。ここで着く答えはもう古い。
    answer(jsonResponse({ revision: CURRENT }));

    await settle();
    expect(applied).toEqual([NEXT]);
  });

  it("知らせを受けて切り替える", async () => {
    const { applied } = start(CURRENT);
    socket().open();

    socket().receive(revisionNotice(NEXT));

    await vi.waitFor(() => expect(applied).toEqual([NEXT]));
    // 切り替えた後に同じ知らせが来ても、もう動かない。
    socket().receive(revisionNotice(NEXT));
    expect(applied).toEqual([NEXT]);
  });

  it("壊れた知らせは捨てる", async () => {
    const { applied } = start(CURRENT);
    socket().open();

    socket().receive("pong");
    socket().receive("{");
    socket().receive(JSON.stringify({ type: "revision", revision: "../x" }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(applied).toEqual([]);
  });

  it("切り替えの最中に来た版は、着地してから当てる", async () => {
    // 並行して走らせると、**遅い方の古い版が後から画面に出る**。
    const gate = deferred();
    const { applied } = start(CURRENT, (revision) =>
      revision === NEXT ? gate.promise : Promise.resolve()
    );
    socket().open();

    socket().receive(revisionNotice(NEXT));
    await vi.waitFor(() => expect(applied).toEqual([NEXT]));

    socket().receive(revisionNotice(LATER));
    expect(applied).toEqual([NEXT]);

    gate.resolve();
    await vi.waitFor(() => expect(applied).toEqual([NEXT, LATER]));
  });

  it("出せなかった版は覚えない (次の知らせでやり直す)", async () => {
    let attempts = 0;
    const { applied } = start(CURRENT, () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("取得できません"))
        : Promise.resolve();
    });
    socket().open();

    socket().receive(revisionNotice(NEXT));
    await vi.waitFor(() => expect(applied).toEqual([NEXT]));

    // 覚えていたら「同じ版」として捨てられてしまう。
    socket().receive(revisionNotice(NEXT));
    await vi.waitFor(() => expect(applied).toEqual([NEXT, NEXT]));
  });

  it("混雑で断られたら繋ぎ直さない", async () => {
    vi.useFakeTimers();
    const { states } = start(CURRENT);
    socket().open();

    socket().drop(LIVE_BUSY_CODE);

    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS * 3);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(states.at(-1)).toBe("off");
  });

  it("切れたら待ってから繋ぎ直す", async () => {
    vi.useFakeTimers();
    const { states } = start(CURRENT);
    socket().open();
    expect(states).toContain("live");

    socket().drop();
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("畳んだら繋ぎ直さない", async () => {
    vi.useFakeTimers();
    const { client, states } = start(CURRENT);
    socket().open();

    client.dispose();
    socket().drop();

    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS * 2);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(states.at(-1)).toBe("off");
  });
});
