/**
 * アセット一覧 (assets.json) の編集 (Phase 3-4)。
 *
 * ここが取りこぼすと、**保存も実行も成功したままアセットだけが消える**形になる
 * (壊れたマニフェストへの書き込み・コードのファイル名との衝突)。どれも画面には
 * 何も出ないので、境界はここで固定する。
 */

import {
  ASSET_MANIFEST_FILE,
  parseAssetManifest,
  serializeAssetManifest,
  type AssetEntry,
  type SketchFiles,
} from "@p5stage/shared";
import { describe, expect, it } from "vitest";

import {
  addAsset,
  assetNameError,
  readManifestState,
  removeAsset,
  uniqueAssetName,
} from "../src/scripts/assets/manifest-edit";

const CAT: AssetEntry = {
  sha256: "a".repeat(64),
  size: 1024,
  mime: "image/png",
};

const DOG: AssetEntry = {
  sha256: "b".repeat(64),
  size: 2048,
  mime: "image/png",
};

/** コードだけの作品 (アセットを一度も使っていない)。 */
const CODE_ONLY: SketchFiles = {
  "index.html": "<!doctype html>",
  "sketch.js": "// hi",
};

/** アセットを 1 件持つ作品。 */
function withAssets(assets: Record<string, AssetEntry>): SketchFiles {
  return {
    ...CODE_ONLY,
    [ASSET_MANIFEST_FILE]: serializeAssetManifest({ version: 1, assets }),
  };
}

/** 書き戻した中身を読み直す (書いたものが必ず読めることも一緒に確かめる)。 */
function parse(content: string): Record<string, AssetEntry> {
  const result = parseAssetManifest(content);
  if (!result.ok) throw new Error(result.message);
  return result.manifest.assets;
}

describe("readManifestState", () => {
  it("assets.json が無い作品は 0 件として読む", () => {
    const state = readManifestState(CODE_ONLY);

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.assets).toEqual([]);
  });

  it("名前順に並べる (書き出しの並びと揃える)", () => {
    const state = readManifestState(
      withAssets({ "dog.png": DOG, "cat.png": CAT })
    );

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.assets.map((asset) => asset.name)).toEqual([
      "cat.png",
      "dog.png",
    ]);
  });

  it("読めないマニフェストは理由ごと返す", () => {
    const state = readManifestState({
      ...CODE_ONLY,
      [ASSET_MANIFEST_FILE]: "{ not json",
    });

    expect(state.kind).toBe("invalid");
    if (state.kind !== "invalid") return;
    expect(state.message).toContain("JSON として読めません");
  });
});

describe("uniqueAssetName", () => {
  it("空いていればそのまま", () => {
    expect(uniqueAssetName("cat.png", new Set())).toBe("cat.png");
  });

  it("埋まっていれば連番を足し、拡張子は残す", () => {
    // 拡張子を落とすと p5 の loadModel が形式を判定できなくなる (ADR 0014)。
    expect(uniqueAssetName("cat.png", new Set(["cat.png"]))).toBe("cat-2.png");
    expect(uniqueAssetName("cat.png", new Set(["cat.png", "cat-2.png"]))).toBe(
      "cat-3.png"
    );
  });

  it("拡張子が無い名前でも連番を足せる", () => {
    expect(uniqueAssetName("data", new Set(["data"]))).toBe("data-2");
  });
});

describe("assetNameError", () => {
  it("予約名は使えない", () => {
    expect(assetNameError(ASSET_MANIFEST_FILE)).toContain("アセットの一覧");
  });

  it("ファイル名として不正な理由をそのまま返す", () => {
    expect(assetNameError("img/cat.png")).toContain("フォルダ");
  });

  it("普通の名前は通す", () => {
    expect(assetNameError("cat.png")).toBeNull();
  });
});

describe("addAsset", () => {
  it("assets.json が無い作品にも足せる", () => {
    const edit = addAsset(CODE_ONLY, "cat.png", CAT);

    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.name).toBe("cat.png");
    expect(parse(edit.content)).toEqual({ "cat.png": CAT });
  });

  it("端末から来る名前の前後の空白は落とす", () => {
    const edit = addAsset(CODE_ONLY, " cat.png ", CAT);

    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.name).toBe("cat.png");
  });

  it("同じ名前で中身が違えば別名にする (黙って差し替えない)", () => {
    const edit = addAsset(withAssets({ "cat.png": CAT }), "cat.png", DOG);

    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.name).toBe("cat-2.png");
    // 元の参照はそのまま。コードの loadImage("cat.png") が別の絵に変わらない。
    expect(parse(edit.content)).toEqual({ "cat.png": CAT, "cat-2.png": DOG });
  });

  it("同じ名前で同じ中身なら何もしない", () => {
    const edit = addAsset(withAssets({ "cat.png": CAT }), "cat.png", CAT);

    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.unchanged).toBe(true);
    expect(parse(edit.content)).toEqual({ "cat.png": CAT });
  });

  it("コードのファイル名とぶつかる名前は避ける", () => {
    // ぶつかったまま足すと保存で断られる (manifestNameConflicts)。
    const edit = addAsset(
      { ...CODE_ONLY, "data.json": "{}" },
      "data.json",
      CAT
    );

    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.name).toBe("data-2.json");
  });

  it("予約名では足せない", () => {
    const edit = addAsset(CODE_ONLY, ASSET_MANIFEST_FILE, CAT);

    expect(edit.ok).toBe(false);
    if (edit.ok) return;
    expect(edit.message).toContain("アセットの一覧");
  });

  it("読めないマニフェストには書き込まない", () => {
    // 上書きすると、直そうとしていた中身ごと消える。
    const edit = addAsset(
      { ...CODE_ONLY, [ASSET_MANIFEST_FILE]: "{ not json" },
      "cat.png",
      CAT
    );

    expect(edit.ok).toBe(false);
    if (edit.ok) return;
    expect(edit.message).toContain("直すまで変えられません");
  });
});

describe("removeAsset", () => {
  it("1 件だけ外す", () => {
    const edit = removeAsset(
      withAssets({ "cat.png": CAT, "dog.png": DOG }),
      "cat.png"
    );

    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(parse(edit.content)).toEqual({ "dog.png": DOG });
  });

  it("最後の 1 件を外しても assets.json は空で残す", () => {
    // 「空 = 全部外した」と「無い = 一度も使っていない」の区別を保つ (3-5 の GC)。
    const edit = removeAsset(withAssets({ "cat.png": CAT }), "cat.png");

    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(parse(edit.content)).toEqual({});
  });

  it("無い名前は断る", () => {
    const edit = removeAsset(withAssets({ "cat.png": CAT }), "dog.png");

    expect(edit.ok).toBe(false);
  });

  it("読めないマニフェストからは外せない", () => {
    const edit = removeAsset(
      { ...CODE_ONLY, [ASSET_MANIFEST_FILE]: "{ not json" },
      "cat.png"
    );

    expect(edit.ok).toBe(false);
  });
});
