/**
 * 回収の匙加減 (Phase 3-5b)。
 *
 * 回収そのものは Cron からしか走らず、猶予の境界を実地で試すには**孤児を作って
 * 何日も待つ**しかない。設定の読み方と締め切りの計算だけをここで固定する。
 *
 * 間違うと消えてはいけない実体が消える方向に効くので、**書き損じた設定を短い方へ
 * 倒さない**ことまで見る。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_GC_GRACE_HOURS,
  graceMillis,
  orphanCutoff,
} from "../src/lib/assets/gc-plan";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MS = DEFAULT_GC_GRACE_HOURS * HOUR_MS;

describe("graceMillis", () => {
  it("時間をミリ秒に直す", () => {
    expect(graceMillis("1")).toBe(HOUR_MS);
    expect(graceMillis("168")).toBe(168 * HOUR_MS);
  });

  it("0 を許す (E2E は猶予を待たずに回収を確かめる)", () => {
    expect(graceMillis("0")).toBe(0);
  });

  it("設定が無ければ既定", () => {
    expect(graceMillis(undefined)).toBe(DEFAULT_MS);
  });

  it("読めない値は既定へ倒す — 短い方へ倒すと消してはいけないものが消える", () => {
    expect(graceMillis("")).toBe(DEFAULT_MS);
    expect(graceMillis("いつか")).toBe(DEFAULT_MS);
    expect(graceMillis("-1")).toBe(DEFAULT_MS);
    expect(graceMillis("Infinity")).toBe(DEFAULT_MS);
  });
});

describe("orphanCutoff", () => {
  const NOW = 1_700_000_000_000;

  it("猶予の分だけ過去が対象になる", () => {
    expect(orphanCutoff(NOW, HOUR_MS)).toBe(NOW - HOUR_MS);
  });

  it("ちょうど猶予が経った印は対象に入る (境界は含む)", () => {
    const markedAt = NOW - HOUR_MS;
    expect(markedAt <= orphanCutoff(NOW, HOUR_MS)).toBe(true);
  });

  it("1ms 足りない印は残る", () => {
    const markedAt = NOW - HOUR_MS + 1;
    expect(markedAt <= orphanCutoff(NOW, HOUR_MS)).toBe(false);
  });

  it("猶予 0 なら今この瞬間の印まで対象", () => {
    expect(NOW <= orphanCutoff(NOW, 0)).toBe(true);
  });
});
