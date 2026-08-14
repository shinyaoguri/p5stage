import { describe, expect, it } from "vitest";

import {
  GENERATED_NAME_MAX_LENGTH,
  generateProjectName,
} from "../src/scripts/sketch/project-name";

/** 0, 1/n, 2/n… と順に返す乱数の代わり (語の一覧を端まで踏むため)。 */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] as number;
}

describe("generateProjectName", () => {
  it("adj-noun-xxx の形になる", () => {
    // 末尾は 36 進 3 桁。名前の部分に数字や記号が混ざらないことも一緒に見る。
    expect(generateProjectName()).toMatch(/^[a-z]+-[a-z]+-[0-9a-z]{3}$/);
  });

  it("一覧に並べても崩れない長さに収まる", () => {
    // 語の一覧の端 (最長の語) を引いても超えないこと。乱数の上限側を踏ませる。
    const nearlyOne = sequence([0.999999]);
    for (let i = 0; i < 200; i += 1) {
      const name = generateProjectName(i === 0 ? nearlyOne : Math.random);
      expect(name.length).toBeLessThanOrEqual(GENERATED_NAME_MAX_LENGTH);
    }
  });

  it("乱数が同じなら同じ名前になる (生成に隠れた状態を持たない)", () => {
    const values = [0.1, 0.7, 0.2, 0.5, 0.9];
    expect(generateProjectName(sequence(values))).toBe(
      generateProjectName(sequence(values))
    );
  });

  it("続けて呼ぶと違う名前になる", () => {
    // 1.17 億通りあるので、20 回引いて全部同じになることは実質起きない。
    const names = new Set(
      Array.from({ length: 20 }, () => generateProjectName())
    );
    expect(names.size).toBeGreaterThan(1);
  });
});
