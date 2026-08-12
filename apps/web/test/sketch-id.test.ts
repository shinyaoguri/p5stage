/**
 * 作品 ID (Phase 2-2)。
 *
 * 限定公開の防御は ID の推測困難性そのものなので (要件 3.4)、
 * 「短いこと」より「連番でも規則的でもないこと」を見る。
 */

import { describe, expect, it } from "vitest";

import {
  generateSketchId,
  isSketchId,
  SKETCH_ID_LENGTH,
} from "../src/lib/sketches/id";

describe("generateSketchId", () => {
  it("毎回違う値になる", () => {
    const ids = new Set(Array.from({ length: 256 }, () => generateSketchId()));
    expect(ids.size).toBe(256);
  });

  it("長さが決まっている", () => {
    expect(generateSketchId()).toHaveLength(SKETCH_ID_LENGTH);
  });

  it("URL にそのまま置ける文字だけを使う", () => {
    for (let i = 0; i < 64; i += 1) {
      const id = generateSketchId();
      // base64 の `+` `/` `=` は経路や検索文字列で意味を持つので出てはいけない。
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(id)).toBe(id);
    }
  });

  it("生成した ID は自分の判定を通る", () => {
    for (let i = 0; i < 32; i += 1) {
      expect(isSketchId(generateSketchId())).toBe(true);
    }
  });
});

describe("isSketchId", () => {
  it("長さの違うものを弾く", () => {
    expect(isSketchId("a".repeat(SKETCH_ID_LENGTH - 1))).toBe(false);
    expect(isSketchId("a".repeat(SKETCH_ID_LENGTH + 1))).toBe(false);
    expect(isSketchId("")).toBe(false);
  });

  it("使わない文字を弾く", () => {
    expect(isSketchId("a".repeat(SKETCH_ID_LENGTH - 1) + "/")).toBe(false);
    expect(isSketchId("a".repeat(SKETCH_ID_LENGTH - 1) + "+")).toBe(false);
    // SQL やパスに紛れ込ませようとする値も形の時点で落ちる。
    expect(isSketchId("../../etc/pass")).toBe(false);
    expect(isSketchId("' OR 1=1 --")).toBe(false);
  });
});
