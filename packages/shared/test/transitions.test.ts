import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSITION_ID,
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  NO_TRANSITION,
  TRANSITION_OPTIONS,
  clampTransitionMs,
  getTransition,
  isTransitionId,
} from "../src/transitions";

/** 「なし」を除いた実際の演出 id。 */
const ids = TRANSITION_OPTIONS.map((option) => option.value).filter(
  (value) => value !== NO_TRANSITION
);

describe("レジストリ", () => {
  it("選択肢の先頭は「なし」", () => {
    expect(TRANSITION_OPTIONS[0]?.value).toBe(NO_TRANSITION);
  });

  it("選択肢の id はすべて引ける", () => {
    for (const id of ids) {
      expect(getTransition(id)?.id).toBe(id);
    }
  });

  it("「なし」と未知の id は引けない", () => {
    expect(getTransition(NO_TRANSITION)).toBeNull();
    expect(getTransition("explode")).toBeNull();
    expect(isTransitionId(NO_TRANSITION)).toBe(false);
    expect(isTransitionId("explode")).toBe(false);
    expect(isTransitionId(undefined)).toBe(false);
  });

  it("既定の演出は選択肢にある", () => {
    expect(isTransitionId(DEFAULT_TRANSITION_ID)).toBe(true);
  });

  it("id と表示名が重複しない", () => {
    const values = TRANSITION_OPTIONS.map((option) => option.value);
    const labels = TRANSITION_OPTIONS.map((option) => option.label);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("設計図", () => {
  it("少なくとも片方のレイヤが動く", () => {
    for (const id of ids) {
      const plan = getTransition(id)!.plan;
      expect(
        plan.outgoing.keyframes !== null || plan.incoming.keyframes !== null
      ).toBe(true);
    }
  });

  it("動かすレイヤの keyframes は 2 枚以上ある", () => {
    for (const id of ids) {
      const { outgoing, incoming } = getTransition(id)!.plan;
      for (const keyframes of [outgoing.keyframes, incoming.keyframes]) {
        if (keyframes === null) continue;
        expect(keyframes.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("初期スタイルは keyframes の最初の値と食い違わない", () => {
    // 食い違うと、初期状態を当ててから遷移を始めるまでの間に一瞬ちらつく。
    for (const id of ids) {
      for (const layer of Object.values(getTransition(id)!.plan)) {
        const first = layer.keyframes?.[0];
        if (first === undefined) continue;
        for (const [property, value] of Object.entries(layer.setup)) {
          if (property === "zIndex") continue; // 重なり順は keyframes で扱わない
          if (!(property in first)) continue;
          expect(String(first[property])).toBe(String(value));
        }
      }
    }
  });

  it("露出系は描画済みの旧フレームを上に置く", () => {
    // 未描画の新フレームを上に出すと、最初の 1 枚を描くまで黒く見える。
    for (const id of ids.filter((value) => value.startsWith("wipe-"))) {
      const { outgoing, incoming } = getTransition(id)!.plan;
      expect(Number(outgoing.setup.zIndex)).toBeGreaterThan(
        Number(incoming.setup.zIndex)
      );
      expect(incoming.keyframes).toBeNull();
    }
  });

  it("ワイプは左右で削る向きが逆になる", () => {
    const last = (id: string) => {
      const keyframes = getTransition(id)!.plan.outgoing.keyframes!;
      return keyframes[keyframes.length - 1]?.clipPath;
    };
    expect(last("wipe-left")).not.toBe(last("wipe-right"));
  });
});

describe("clampTransitionMs", () => {
  it("範囲内はそのまま", () => {
    expect(clampTransitionMs(400)).toBe(400);
  });

  it("範囲外は丸める", () => {
    expect(clampTransitionMs(0)).toBe(MIN_TRANSITION_MS);
    expect(clampTransitionMs(-1)).toBe(MIN_TRANSITION_MS);
    expect(clampTransitionMs(10_000)).toBe(MAX_TRANSITION_MS);
  });

  it("数として扱えない値は既定に倒す", () => {
    expect(clampTransitionMs(Number.NaN)).toBe(DEFAULT_TRANSITION_MS);
    expect(clampTransitionMs(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_TRANSITION_MS
    );
  });
});
