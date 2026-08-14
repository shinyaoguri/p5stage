/**
 * 配信用リビジョンのキー (ADR 0011) と、その逆変換 (Phase 3-5b)。
 *
 * バックフィルは**書いた側の記録が無い**リビジョンを R2 から拾い直すので、キーが
 * 唯一の手掛かりになる。ここがずれると、既に配られているリビジョンが台帳に載らず、
 * それが使っている実体を回収が孤児と見なす。**往復で固定する。**
 */

import { describe, expect, it } from "vitest";

import {
  parseRevisionKey,
  revisionKey,
} from "../src/lib/sketches/revision-store";

describe("parseRevisionKey", () => {
  it("revisionKey が作ったキーから元の組が戻る", () => {
    const gistId = "0123456789abcdef0123456789abcdef";
    const revision = "9".repeat(40);

    expect(parseRevisionKey(revisionKey(gistId, revision))).toEqual({
      gistId,
      revision,
    });
  });

  it("別の前置きのオブジェクトは読まない", () => {
    expect(parseRevisionKey("blobs/abc.json")).toBeNull();
  });

  it("拡張子が違うものは読まない", () => {
    expect(parseRevisionKey("gists/abc/def.txt")).toBeNull();
  });

  it("階層が合わないものは読まない", () => {
    expect(parseRevisionKey("gists/abc.json")).toBeNull();
    expect(parseRevisionKey("gists/abc/def/ghi.json")).toBeNull();
  });

  it("どちらかが空なら読まない", () => {
    expect(parseRevisionKey("gists//def.json")).toBeNull();
    expect(parseRevisionKey("gists/abc/.json")).toBeNull();
  });
});
