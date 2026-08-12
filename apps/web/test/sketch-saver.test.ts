/**
 * 保存の段取り (Phase 2-3)。
 *
 * 保存は「押したら送る」だけでは足りない。**初回は器を作ってから**送る、
 * **保存中に来た変更を落とさない**、**別の作品へ切り替えたら飛んでいる保存の結果を
 * 反映しない** — どれも取りこぼすと、静かに内容が失われる側に倒れる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SketchSaver,
  type SaveState,
} from "../src/scripts/sketch/sketch-saver";

const FILES = { "index.html": "<!doctype html>", "sketch.js": "// hi" };

const GIST = {
  id: "abc123",
  url: "https://gist.github.com/u/abc123",
  revision: "cafe1234",
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/**
 * 口ごとに応答を決める fetch。
 *
 * 実際の順番 (POST /api/sketches → PUT .../files) を確かめたいので、
 * 呼ばれた記録も残す。
 */
function stubApi(
  handlers: {
    create?: () => Response;
    put?: () => Response;
  } = {}
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body === undefined ? null : JSON.parse(String(init.body)),
      });

      if (url === "/api/sketches") {
        return Promise.resolve(
          handlers.create?.() ??
            Response.json(
              { sketch: { id: "SKETCH0000000000" } },
              { status: 201 }
            )
        );
      }
      return Promise.resolve(handlers.put?.() ?? Response.json({ gist: GIST }));
    })
  );
  return calls;
}

function createSaver(options: { sketchId?: string | null } = {}): {
  saver: SketchSaver;
  states: SaveState[];
  created: string[];
} {
  const states: SaveState[] = [];
  const created: string[] = [];
  const saver = new SketchSaver({
    getFiles: () => FILES,
    onState: (state) => states.push(state),
    onCreated: (id) => created.push(id),
    sketchId: options.sketchId ?? null,
  });
  return { saver, states, created };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("初回の保存", () => {
  it("器を作ってから中身を送る", async () => {
    const calls = stubApi();
    const { saver, created } = createSaver();

    await saver.saveNow({ title: "波紋", visibility: "public" });

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/sketches",
      "PUT /api/sketches/SKETCH0000000000/files",
    ]);
    expect(calls[0]?.body).toEqual({ title: "波紋", visibility: "public" });
    expect(calls[1]?.body).toEqual({ files: FILES });
    // URL に載せ直せるよう、できた ID を知らせる。
    expect(created).toEqual(["SKETCH0000000000"]);
    expect(saver.state.status).toBe("saved");
    expect(saver.state.gist).toEqual(GIST);
  });

  it("自動保存では作らない", () => {
    const calls = stubApi();
    const { saver } = createSaver();

    saver.markDirty();
    saver.scheduleSave();
    vi.runAllTimers();

    // 利用者の GitHub に物を作る操作なので、最初の 1 回は明示の保存だけ。
    expect(calls).toEqual([]);
    expect(saver.state.status).toBe("unsaved");
  });
});

describe("保存済みの作品", () => {
  it("実行のたびに間引いて送る", async () => {
    const calls = stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);

    saver.markDirty();
    saver.scheduleSave();
    saver.scheduleSave();
    saver.scheduleSave();
    await vi.runAllTimersAsync();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
  });

  it("変更が無ければ送らない", async () => {
    const calls = stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);

    saver.scheduleSave();
    await vi.runAllTimersAsync();
    await saver.saveNow();

    // 同じ内容のリビジョンを積むと履歴が読みにくくなるだけ。
    expect(calls).toEqual([]);
  });

  it("保存中に来た変更は捨てずにもう一度送る", async () => {
    const calls = stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();

    const saving = saver.saveNow();
    saver.markDirty();
    await saving;

    expect(calls).toHaveLength(2);
    expect(saver.state.status).toBe("saved");
  });
});

describe("失敗したとき", () => {
  it("理由を残し、内容は未保存のまま抱えておく", async () => {
    stubApi({
      put: () =>
        Response.json(
          { error: "unauthorized", message: "ログインが必要です" },
          { status: 401 }
        ),
    });
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();

    await saver.saveNow();

    expect(saver.state.status).toBe("error");
    expect(saver.state.message).toBe("ログインが必要です");
  });

  it("失敗のあと、次の保存で送り直せる", async () => {
    let failing = true;
    const calls = stubApi({
      put: () =>
        failing
          ? new Response("", { status: 502 })
          : Response.json({ gist: GIST }),
    });
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();

    await saver.saveNow();
    failing = false;
    await saver.saveNow();

    expect(calls).toHaveLength(2);
    expect(saver.state.status).toBe("saved");
  });

  it("打鍵では失敗の理由を消さない", async () => {
    stubApi({ put: () => new Response("", { status: 502 }) });
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();
    await saver.saveNow();

    saver.markDirty();

    // 消えると、なぜ保存できていないのか分からないまま書き続けることになる。
    expect(saver.state.status).toBe("error");
  });
});

describe("別の作品へ切り替えたとき", () => {
  it("予約していた自動保存は前の作品へ飛ばない", async () => {
    const calls = stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();
    saver.scheduleSave();

    saver.detach();
    await vi.runAllTimersAsync();

    expect(calls).toEqual([]);
    expect(saver.state.sketchId).toBeNull();
    expect(saver.state.status).toBe("unsaved");
  });

  it("飛んでいた保存の結果で状態を戻さない", async () => {
    stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();

    const saving = saver.saveNow();
    saver.detach();
    await saving;

    // 新しく書き始めた側から見れば、まだ一度も保存していない。
    expect(saver.state.status).toBe("unsaved");
    expect(saver.state.gist).toBeNull();
  });
});

describe("Gist を外したとき (Phase 2-6)", () => {
  it("作品は残したまま未保存に戻す", () => {
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);

    saver.forgetGist();

    // 別の作品に移ったのではない。同じ作品の続きを、正本の無い状態で書いている。
    expect(saver.state.sketchId).toBe("SKETCH0000000000");
    expect(saver.state.gist).toBeNull();
    expect(saver.state.status).toBe("unsaved");
  });

  it("外した後の保存は新しい Gist を作りに行く", async () => {
    const calls = stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);

    saver.forgetGist();
    await saver.saveNow();

    // 器は既にあるので作り直さない。中身を送れば、サーバ側が新しい Gist を作る。
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "PUT /api/sketches/SKETCH0000000000/files",
    ]);
  });

  it("予約していた自動保存は消えた Gist へ飛ばない", async () => {
    const calls = stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();
    saver.scheduleSave();

    saver.forgetGist();
    await vi.runAllTimersAsync();

    expect(calls).toEqual([]);
  });

  it("飛んでいた保存の結果で保存済みに戻さない", async () => {
    stubApi();
    const { saver } = createSaver({ sketchId: "SKETCH0000000000" });
    saver.adopt("SKETCH0000000000", GIST);
    saver.markDirty();

    const saving = saver.saveNow();
    saver.forgetGist();
    await saving;

    // 外す前に走り出した保存が着地しても、その Gist はもう正本ではない。
    expect(saver.state.gist).toBeNull();
    expect(saver.state.status).toBe("unsaved");
  });
});
