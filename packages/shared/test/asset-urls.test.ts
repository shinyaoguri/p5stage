import { describe, expect, it } from "vitest";

import {
  ASSET_ROUTE_PREFIX,
  assetPath,
  assetUrl,
  assetUrlsForFiles,
} from "../src/asset-urls";
import { serializeAssetManifest } from "../src/asset-manifest";
import type { AssetManifest } from "../src/asset-manifest";

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const ORIGIN = "https://assets.example";

function manifestFiles(manifest: AssetManifest): Record<string, string> {
  return {
    "index.html": "<html></html>",
    "assets.json": serializeAssetManifest(manifest),
  };
}

describe("assetPath", () => {
  it("sha256 とファイル名を並べる", () => {
    expect(assetPath(DIGEST, "cat.png")).toBe(
      `${ASSET_ROUTE_PREFIX}${DIGEST}/cat.png`
    );
  });

  // 名前は表示と拡張子のためだけにあるので、パスを壊す文字は逃がす。
  it("パスを壊す文字を逃がす", () => {
    expect(assetPath(DIGEST, "a b/c?d#e.png")).toBe(
      `${ASSET_ROUTE_PREFIX}${DIGEST}/a%20b%2Fc%3Fd%23e.png`
    );
  });

  // p5 の loadModel はパスの末尾 4 文字で形式を判定する (ADR 0014)。
  it("拡張子が末尾に残る", () => {
    expect(assetPath(DIGEST, "bunny.obj").slice(-4)).toBe(".obj");
  });
});

describe("assetUrl", () => {
  it("配信オリジンの絶対 URL にする", () => {
    expect(assetUrl(ORIGIN, DIGEST, "cat.png")).toBe(
      `${ORIGIN}/a/${DIGEST}/cat.png`
    );
  });
});

describe("assetUrlsForFiles", () => {
  it("マニフェストのアセットを URL の表にする", () => {
    const files = manifestFiles({
      version: 1,
      assets: {
        "cat.png": { sha256: DIGEST, size: 10, mime: "image/png" },
        "data.json": {
          sha256: OTHER_DIGEST,
          size: 20,
          mime: "application/json",
        },
      },
    });

    expect(assetUrlsForFiles(files, ORIGIN)).toEqual({
      "cat.png": `${ORIGIN}/a/${DIGEST}/cat.png`,
      "data.json": `${ORIGIN}/a/${OTHER_DIGEST}/data.json`,
    });
  });

  it("assets.json が無ければ空の表", () => {
    expect(assetUrlsForFiles({ "index.html": "" }, ORIGIN)).toEqual({});
  });

  // 壊れたマニフェストで実行そのものを止めない (知らせは保存経路とエディタが出す)。
  it("読めないマニフェストは空の表", () => {
    expect(
      assetUrlsForFiles({ "index.html": "", "assets.json": "{ broken" }, ORIGIN)
    ).toEqual({});
  });

  it("配信オリジンが無ければ空の表", () => {
    const files = manifestFiles({
      version: 1,
      assets: { "cat.png": { sha256: DIGEST, size: 10, mime: "image/png" } },
    });
    expect(assetUrlsForFiles(files, null)).toEqual({});
  });
});
