/**
 * 保存経路がマニフェストをどう見るか (Phase 3-2)。
 *
 * ここを通ったものが正本の Gist に入る。通してはいけない形を固定する。
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_MANIFEST_FILE,
  emptyAssetManifest,
  withAssetManifest,
  type SketchFiles,
} from "@p5stage/shared";

import {
  checkManifest,
  unclaimedMessage,
} from "../src/lib/assets/manifest-check";

const DIGEST = "c".repeat(64);

const CODE: SketchFiles = {
  "index.html": "<html></html>",
  "sketch.js": "",
};

function withAssets(assets: Record<string, unknown>): SketchFiles {
  return {
    ...CODE,
    [ASSET_MANIFEST_FILE]: JSON.stringify({ version: 1, assets }),
  };
}

describe("checkManifest", () => {
  it("assets.json が無ければ何も確かめない", () => {
    expect(checkManifest(CODE)).toEqual({ kind: "absent" });
  });

  it("空の一覧は通す (アセットを全部外した作品)", () => {
    const check = checkManifest(withAssetManifest(CODE, emptyAssetManifest()));
    expect(check).toEqual({
      kind: "ok",
      manifest: emptyAssetManifest(),
      digests: [],
    });
  });

  it("参照している実体を重複なく返す (所有の確認に使う)", () => {
    const check = checkManifest(
      withAssets({
        "cat.png": { sha256: DIGEST, size: 12, mime: "image/png" },
        "same.png": { sha256: DIGEST, size: 12, mime: "image/png" },
      })
    );
    expect(check.kind === "ok" && check.digests).toEqual([DIGEST]);
  });

  it("壊れていれば理由を持って断る", () => {
    const check = checkManifest({ ...CODE, [ASSET_MANIFEST_FILE]: "{" });
    expect(check.kind).toBe("invalid");
    expect(check.kind === "invalid" && check.message).toContain(
      ASSET_MANIFEST_FILE
    );
  });

  it("コードのファイルと名前がぶつかれば断る (どちらが返るか決まらない)", () => {
    const files = {
      ...withAssets({
        "data.json": { sha256: DIGEST, size: 12, mime: "application/json" },
      }),
      "data.json": "{}",
    };
    const check = checkManifest(files);
    expect(check.kind).toBe("invalid");
    expect(check.kind === "invalid" && check.message).toContain("data.json");
  });
});

describe("unclaimedMessage", () => {
  it("件数で言う (64 桁を見せても直しようが無い)", () => {
    expect(unclaimedMessage(2)).toContain("2 件");
    expect(unclaimedMessage(2)).not.toContain(DIGEST);
  });
});
