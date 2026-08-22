/**
 * 配信に載せてよいかの判断 (#70)。
 *
 * 実地で試すには「作者が gist.github.com で `assets.json` を書き換える」までを
 * 再現する必要があり (E2E が受け持つ)、ここは**どの結果を断るか**の線引きだけを
 * 固定する。間違うと、他人のアセットを参照する作品が配られる方向にも、作者の
 * 正しい編集が反映されない方向にも倒れる。
 */

import { describe, expect, it } from "vitest";

import type { ManifestCheck } from "../src/lib/assets/manifest-check";
import { gateManifest } from "../src/lib/sketches/delivery-gate";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

const ok: ManifestCheck = {
  kind: "ok",
  manifest: { version: 1, assets: {} },
  digests: [DIGEST_A, DIGEST_B],
};

describe("gateManifest", () => {
  it("アセットを使っていない作品は通す", () => {
    expect(gateManifest({ kind: "absent" }, [])).toEqual({ kind: "pass" });
  });

  it("読めないマニフェストは通す (sha256 が導出されず、配られる実体が無い)", () => {
    const invalid: ManifestCheck = { kind: "invalid", message: "壊れています" };
    expect(gateManifest(invalid, [])).toEqual({ kind: "pass" });
  });

  it("参照している blob をすべて所有していれば通す", () => {
    expect(gateManifest(ok, [])).toEqual({ kind: "pass" });
  });

  it("所有していない blob が 1 つでもあれば断る", () => {
    const gate = gateManifest(ok, [DIGEST_B]);
    expect(gate.kind).toBe("reject");
    if (gate.kind !== "reject") return;
    expect(gate.unclaimed).toEqual([DIGEST_B]);
  });

  it("断る文言に sha256 を出さない (64 桁を見せても直しようが無い)", () => {
    const gate = gateManifest(ok, [DIGEST_A, DIGEST_B]);
    if (gate.kind !== "reject") throw new Error("断っていない");
    expect(gate.message).toContain("2 件");
    expect(gate.message).not.toContain(DIGEST_A);
  });
});
