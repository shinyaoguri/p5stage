import { describe, expect, it } from "vitest";

import {
  ConsoleLog,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_REPEAT,
} from "../src/scripts/editor/console-log";

describe("ConsoleLog", () => {
  it("届いた順に積む", () => {
    const log = new ConsoleLog();
    expect(log.add("log", "a", 1)).toEqual({
      kind: "appended",
      entry: { level: "log", message: "a", timestamp: 1, count: 1 },
      dropped: 0,
    });
    log.add("warn", "b", 2);
    expect(log.entries.map((entry) => entry.message)).toEqual(["a", "b"]);
  });

  it("直前と同じ行はまとめる", () => {
    const log = new ConsoleLog();
    log.add("log", "a", 1);
    expect(log.add("log", "a", 5)).toEqual({
      kind: "repeated",
      entry: { level: "log", message: "a", timestamp: 5, count: 2 },
    });
    expect(log.entries).toHaveLength(1);
  });

  it("種別が違えばまとめない", () => {
    const log = new ConsoleLog();
    log.add("log", "a", 1);
    log.add("error", "a", 2);
    expect(log.entries).toHaveLength(2);
  });

  it("間に別の行が挟まればまとめない", () => {
    const log = new ConsoleLog();
    log.add("log", "a", 1);
    log.add("log", "b", 2);
    log.add("log", "a", 3);
    expect(log.entries.map((entry) => entry.message)).toEqual(["a", "b", "a"]);
  });

  it("まとめた回数は上限で止まる", () => {
    const log = new ConsoleLog();
    for (let i = 0; i <= MAX_CONSOLE_REPEAT + 5; i += 1) log.add("log", "a", i);
    expect(log.entries[0]?.count).toBe(MAX_CONSOLE_REPEAT);
  });

  it("上限を超えたら古い行から捨てる", () => {
    const log = new ConsoleLog();
    for (let i = 0; i < MAX_CONSOLE_ENTRIES; i += 1) log.add("log", `#${i}`, i);
    const update = log.add("log", "last", 0);

    expect(update).toMatchObject({ kind: "appended", dropped: 1 });
    expect(log.entries).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(log.entries[0]?.message).toBe("#1");
    expect(log.entries[MAX_CONSOLE_ENTRIES - 1]?.message).toBe("last");
  });

  it("種別ごとの総数は捨てた行も数える", () => {
    const log = new ConsoleLog();
    for (let i = 0; i < MAX_CONSOLE_ENTRIES + 10; i += 1) {
      log.add("error", `#${i}`, i);
    }
    log.add("error", "同じ", 0);
    log.add("error", "同じ", 1);

    expect(log.countOf("error")).toBe(MAX_CONSOLE_ENTRIES + 12);
    expect(log.countOf("warn")).toBe(0);
    expect(log.total).toBe(MAX_CONSOLE_ENTRIES + 12);
  });

  it("消すと空に戻る", () => {
    const log = new ConsoleLog();
    log.add("error", "a", 1);
    log.clear();
    expect(log.entries).toHaveLength(0);
    expect(log.countOf("error")).toBe(0);
    expect(log.total).toBe(0);
  });
});
