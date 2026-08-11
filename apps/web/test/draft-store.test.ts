import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftSaver, loadDraft } from "../src/scripts/draft/draft-store";
import type { SketchDraft } from "../src/scripts/draft/draft";
import type { Store } from "../src/scripts/storage/idb-store";

const FILES = { "index.html": "<!doctype html>", "sketch.js": "// hi" };

/**
 * 保存先の代役。put / delete の順番と、書き込み中に別の操作が割り込む状況を
 * 作れるようにしてある (IndexedDB は非同期で、順序は実装が保証すべきもの)。
 */
function createFakeStore() {
  const values = new Map<string, unknown>();
  const calls: string[] = [];
  let putBlock: Promise<void> | null = null;
  let releasePut: (() => void) | null = null;
  let failing = false;

  const store: Store<unknown> = {
    async get(key) {
      if (failing) throw new Error("読めない");
      return values.get(key);
    },
    async put(key, value) {
      calls.push("put");
      if (putBlock !== null) await putBlock;
      if (failing) throw new Error("書けない");
      values.set(key, value);
    },
    async delete(key) {
      calls.push("delete");
      if (failing) throw new Error("消せない");
      values.delete(key);
    },
  };

  return {
    store,
    values,
    calls,
    fail() {
      failing = true;
    },
    /**
     * 以降の put だけを `release()` まで着地させない。
     * 遅い書き込みを速い削除が追い越す状況 (IndexedDB では普通に起きる) を作る。
     */
    holdPut() {
      putBlock = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
    },
    release() {
      putBlock = null;
      releasePut?.();
    },
  };
}

describe("ドラフトの読み込み", () => {
  it("保存済みのものを読める", async () => {
    const fake = createFakeStore();
    fake.values.set("current", {
      files: FILES,
      activeFile: "sketch.js",
      savedAt: 5,
    });
    expect(await loadDraft(fake.store)).toEqual({
      files: FILES,
      activeFile: "sketch.js",
      savedAt: 5,
    });
  });

  it("読めない環境でも投げずに null を返す", async () => {
    const fake = createFakeStore();
    fake.fail();
    expect(await loadDraft(fake.store)).toBeNull();
  });
});

describe("ドラフトの保存", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("打鍵が止まってから 1 度だけ書く", async () => {
    const fake = createFakeStore();
    const saver = new DraftSaver({ store: fake.store });

    saver.save({ ...FILES, "sketch.js": "1" }, "sketch.js");
    await vi.advanceTimersByTimeAsync(300);
    saver.save({ ...FILES, "sketch.js": "12" }, "sketch.js");
    await vi.advanceTimersByTimeAsync(600);
    expect(fake.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(100);
    expect(fake.calls).toEqual(["put"]);
    expect((fake.values.get("current") as SketchDraft).files["sketch.js"]).toBe(
      "12"
    );
  });

  it("打鍵が続いていても最長の待ち時間で一度書く", async () => {
    const fake = createFakeStore();
    const saver = new DraftSaver({ store: fake.store });

    // 間引きの期限だけだと、書き続けている人ほど保存されないことになる。
    for (let i = 0; i < 20; i += 1) {
      saver.save({ ...FILES, "sketch.js": `${i}` }, "sketch.js");
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(fake.calls).toEqual(["put"]);
    const saved = fake.values.get("current") as SketchDraft;
    // 3000ms 時点までに届いていた内容が書かれている (途中の姿でよい)。
    expect(saved.files["sketch.js"]).toBe("14");
  });

  it("最長の待ち時間は書くたびに引き直す", async () => {
    const fake = createFakeStore();
    const saver = new DraftSaver({ store: fake.store });

    saver.save(FILES, "sketch.js");
    await vi.advanceTimersByTimeAsync(700);
    expect(fake.calls).toEqual(["put"]);

    saver.save({ ...FILES, "sketch.js": "next" }, "sketch.js");
    await vi.advanceTimersByTimeAsync(700);
    expect(fake.calls).toEqual(["put", "put"]);
  });

  it("flush は予約を待たずに書き、予約が無ければ何もしない", async () => {
    const fake = createFakeStore();
    const saver = new DraftSaver({ store: fake.store });

    saver.save(FILES, "index.html");
    await saver.flush();
    expect(fake.calls).toEqual(["put"]);

    await saver.flush();
    expect(fake.calls).toEqual(["put"]);

    // 予約は flush で消えているので、後から期限が来ても二重に書かない。
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.calls).toEqual(["put"]);
  });

  it("保存できなくても投げず、次の変更でまた試みる", async () => {
    const fake = createFakeStore();
    fake.fail();
    const onError = vi.fn();
    const onSaved = vi.fn();
    const saver = new DraftSaver({ store: fake.store, onSaved, onError });

    saver.save(FILES, "sketch.js");
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();

    saver.save(FILES, "sketch.js");
    await saver.flush();
    expect(fake.calls).toEqual(["put", "put"]);
  });

  it("破棄すると予約中の保存も捨てる", async () => {
    const fake = createFakeStore();
    const saver = new DraftSaver({ store: fake.store });

    saver.save(FILES, "sketch.js");
    await saver.clear();
    await vi.advanceTimersByTimeAsync(5000);

    // 消した先から予約が書き戻したら、破棄したことにならない。
    expect(fake.calls).toEqual(["delete"]);
    expect(fake.values.has("current")).toBe(false);
  });

  it("飛んでいる保存を破棄が追い越さない", async () => {
    const fake = createFakeStore();
    const saver = new DraftSaver({ store: fake.store });

    // 保存が着地する前に破棄が済んでしまうと、消した後から書き戻されて
    // ドラフトが甦る。呼んだ順に着地させる必要がある。
    fake.holdPut();
    saver.save(FILES, "sketch.js");
    const saving = saver.flush();
    const clearing = saver.clear();
    fake.release();
    await Promise.all([saving, clearing]);

    expect(fake.calls).toEqual(["put", "delete"]);
    expect(fake.values.has("current")).toBe(false);
  });
});
