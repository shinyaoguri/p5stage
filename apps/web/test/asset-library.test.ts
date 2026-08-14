/**
 * 持っているアセット (所有) の読み出しと手放し (Phase 3-4b)。
 *
 * ここで取りこぼすと**まだ使っているアセットに削除の口が出る**。手放した瞬間では
 * なく次の保存で断られる (3-2) 壊れ方なので、画面を見ていても気付けない。
 * 突き合わせの境界をここで固定する。
 */

import {
  ASSET_MANIFEST_FILE,
  serializeAssetManifest,
  type AssetEntry,
  type SketchFiles,
} from "@p5stage/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetBlob } from "../src/lib/assets/asset";
import {
  fetchAssetLibrary,
  libraryRows,
  releaseAsset,
} from "../src/scripts/assets/asset-library";

const USAGE = { bytes: 100, quotaBytes: 1000, maxAssetBytes: 500 };

const CAT: AssetBlob = {
  sha256: "a".repeat(64),
  size: 1024,
  mime: "image/png",
  createdAt: 1,
};

const DOG: AssetBlob = {
  sha256: "b".repeat(64),
  size: 2048,
  mime: "image/png",
  createdAt: 2,
};

/** コードだけの作品 (アセットを一度も使っていない)。 */
const CODE_ONLY: SketchFiles = {
  "index.html": "<!doctype html>",
  "sketch.js": "// hi",
};

function entry(blob: AssetBlob): AssetEntry {
  return { sha256: blob.sha256, size: blob.size, mime: blob.mime };
}

function withAssets(assets: Record<string, AssetEntry>): SketchFiles {
  return {
    ...CODE_ONLY,
    [ASSET_MANIFEST_FILE]: serializeAssetManifest({ version: 1, assets }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("libraryRows", () => {
  it("今の作品で使っている名前を添える", () => {
    const rows = libraryRows([CAT, DOG], withAssets({ "cat.png": entry(CAT) }));

    expect(rows.map((row) => row.usedAs)).toEqual([["cat.png"], []]);
  });

  it("同じ実体が別の名前で 2 回載っていれば両方を添える", () => {
    const rows = libraryRows(
      [CAT],
      withAssets({ "cat.png": entry(CAT), "same.png": entry(CAT) })
    );

    // 片方だけ外しても、まだ使っている名前が残る = 手放してはいけない。
    expect(rows[0]?.usedAs).toEqual(["cat.png", "same.png"]);
  });

  it("並びはサーバが返した順のまま (使用中を先頭へ寄せない)", () => {
    const rows = libraryRows([DOG, CAT], withAssets({ "cat.png": entry(CAT) }));

    expect(rows.map((row) => row.asset.sha256)).toEqual([
      DOG.sha256,
      CAT.sha256,
    ]);
  });

  it("マニフェストが無くても一覧は出る (所有は作品と無関係にある)", () => {
    const rows = libraryRows([CAT], CODE_ONLY);

    expect(rows).toEqual([{ asset: CAT, usedAs: [] }]);
  });

  it("マニフェストが壊れていても一覧は出る", () => {
    const rows = libraryRows([CAT], {
      ...CODE_ONLY,
      [ASSET_MANIFEST_FILE]: "{ broken",
    });

    // 使われ方が分からないだけ。ここで一覧ごと消すと、容量を空ける手段まで消える。
    expect(rows).toEqual([{ asset: CAT, usedAs: [] }]);
  });
});

describe("fetchAssetLibrary", () => {
  it("所有一覧と使用量を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ assets: [CAT], usage: USAGE }))
      )
    );

    expect(await fetchAssetLibrary()).toEqual({ assets: [CAT], usage: USAGE });
  });

  it("未ログインは失敗ではなく null (エディタはログイン無しでも使える)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: "unauthorized" }, { status: 401 })
        )
      )
    );

    expect(await fetchAssetLibrary()).toBeNull();
  });
});

describe("releaseAsset", () => {
  it("DELETE を投げ、返ってきた使用量を渡す", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ url, method: init.method ?? "GET" });
        return Promise.resolve(Response.json({ usage: USAGE }));
      })
    );

    const result = await releaseAsset(CAT.sha256);

    expect(result).toEqual({ ok: true, usage: USAGE });
    expect(calls).toEqual([
      { url: `/api/assets/${CAT.sha256}`, method: "DELETE" },
    ]);
  });

  it("断られた理由はサーバの文言をそのまま伝える", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: "not_found", message: "そのアセットは持っていません" },
            { status: 404 }
          )
        )
      )
    );

    const result = await releaseAsset(CAT.sha256);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("そのアセットは持っていません");
  });

  it("繋がらないときは接続を疑う文言にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );

    const result = await releaseAsset(CAT.sha256);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("接続を確認");
  });
});
