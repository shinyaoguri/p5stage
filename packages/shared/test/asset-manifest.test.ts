/**
 * assets.json の読み書き (Phase 3-2)。
 *
 * このファイルは**利用者の Gist に残り続け、手で壊せる**。緩めると、壊れた一覧が
 * 正本に入ったまま保存され、次に開いても直しようが無い形で残る。逆に厳しすぎると
 * 直す手段まで塞ぐので、境界をここで固定する。
 */

import { describe, expect, it } from "vitest";

import {
  ASSET_MANIFEST_FILE,
  emptyAssetManifest,
  manifestDigests,
  manifestNameConflicts,
  parseAssetManifest,
  readAssetManifest,
  serializeAssetManifest,
  withAssetManifest,
  type AssetManifest,
} from "../src/asset-manifest";

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

function manifestText(assets: unknown, version: unknown = 1): string {
  return JSON.stringify({ version, assets });
}

describe("parseAssetManifest", () => {
  it("正しい一覧をそのまま読む", () => {
    const result = parseAssetManifest(
      manifestText({
        "cat.png": { sha256: DIGEST, size: 12, mime: "image/png" },
      })
    );

    expect(result).toEqual({
      ok: true,
      manifest: {
        version: 1,
        assets: { "cat.png": { sha256: DIGEST, size: 12, mime: "image/png" } },
      },
    });
  });

  it("アセットが 1 つも無い一覧も正しい (全部消した作品)", () => {
    const result = parseAssetManifest(manifestText({}));
    expect(result.ok).toBe(true);
  });

  it("知らない項目は落とす (持ち回る値を増やさせない)", () => {
    const result = parseAssetManifest(
      manifestText({
        "cat.png": {
          sha256: DIGEST,
          size: 12,
          mime: "image/png",
          url: "https://example.com/cat.png",
        },
      })
    );

    expect(result.ok && result.manifest.assets["cat.png"]).toEqual({
      sha256: DIGEST,
      size: 12,
      mime: "image/png",
    });
  });

  it("JSON として読めなければ断る", () => {
    const result = parseAssetManifest("{");
    expect(result).toEqual({
      ok: false,
      message: `${ASSET_MANIFEST_FILE}: JSON として読めません`,
    });
  });

  it.each([
    ["配列", "[]"],
    ["null", "null"],
    ["文字列", '"assets"'],
  ])("オブジェクトでなければ断る (%s)", (_label, text) => {
    expect(parseAssetManifest(text).ok).toBe(false);
  });

  it("version が無ければ断る", () => {
    expect(parseAssetManifest(JSON.stringify({ assets: {} })).ok).toBe(false);
  });

  it("知らない版は「読めない」と伝えて断る (読み飛ばすと保存で消える)", () => {
    const result = parseAssetManifest(manifestText({}, 2));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("新しい形式");
  });

  it("assets が無ければ断る", () => {
    expect(parseAssetManifest(JSON.stringify({ version: 1 })).ok).toBe(false);
  });

  it.each([
    ["sha256 が短い", { sha256: "a".repeat(63), size: 1, mime: "image/png" }],
    ["sha256 が大文字", { sha256: "A".repeat(64), size: 1, mime: "image/png" }],
    ["size が 0", { sha256: DIGEST, size: 0, mime: "image/png" }],
    ["size が小数", { sha256: DIGEST, size: 1.5, mime: "image/png" }],
    ["size が文字列", { sha256: DIGEST, size: "12", mime: "image/png" }],
    ["allowlist の外", { sha256: DIGEST, size: 1, mime: "image/svg+xml" }],
    ["中身が配列", []],
    ["中身が null", null],
  ])("中身が不正なら断る (%s)", (_label, entry) => {
    expect(parseAssetManifest(manifestText({ "cat.png": entry })).ok).toBe(
      false
    );
  });

  it("ファイル名として使えない名前は断る", () => {
    const result = parseAssetManifest(
      manifestText({
        "img/cat.png": { sha256: DIGEST, size: 1, mime: "image/png" },
      })
    );
    expect(result.ok).toBe(false);
  });

  it("assets.json 自身はアセットにできない", () => {
    const result = parseAssetManifest(
      manifestText({
        [ASSET_MANIFEST_FILE]: {
          sha256: DIGEST,
          size: 1,
          mime: "application/json",
        },
      })
    );
    expect(result.ok).toBe(false);
  });
});

describe("serializeAssetManifest", () => {
  const manifest: AssetManifest = {
    version: 1,
    assets: {
      "zebra.png": { sha256: OTHER_DIGEST, size: 2, mime: "image/png" },
      "ant.png": { sha256: DIGEST, size: 1, mime: "image/png" },
    },
  };

  it("名前順に並べる (中身が同じなら同じ文字列になる)", () => {
    const text = serializeAssetManifest(manifest);
    expect(text.indexOf("ant.png")).toBeLessThan(text.indexOf("zebra.png"));

    const reordered = serializeAssetManifest({
      version: 1,
      assets: {
        "ant.png": { sha256: DIGEST, size: 1, mime: "image/png" },
        "zebra.png": { sha256: OTHER_DIGEST, size: 2, mime: "image/png" },
      },
    });
    expect(reordered).toBe(text);
  });

  it("読み直すと同じ一覧になる", () => {
    const result = parseAssetManifest(serializeAssetManifest(manifest));
    expect(result.ok && result.manifest).toEqual(manifest);
  });

  it("改行で終わる (Gist の差分が最終行だけ動かない)", () => {
    expect(serializeAssetManifest(emptyAssetManifest()).endsWith("\n")).toBe(
      true
    );
  });
});

describe("readAssetManifest", () => {
  it("assets.json が無ければ null (「無い」と「空」を区別する)", () => {
    expect(readAssetManifest({ "sketch.js": "" })).toBeNull();
  });

  it("空の一覧は null ではなく空として読む", () => {
    const files = withAssetManifest({ "sketch.js": "" }, emptyAssetManifest());
    const result = readAssetManifest(files);
    expect(result?.ok).toBe(true);
  });

  it("壊れていれば理由を返す", () => {
    const result = readAssetManifest({ [ASSET_MANIFEST_FILE]: "nope" });
    expect(result?.ok).toBe(false);
  });
});

describe("manifestDigests", () => {
  it("同じ実体を指す 2 つのアセットは 1 つに畳む", () => {
    const digests = manifestDigests({
      version: 1,
      assets: {
        "a.png": { sha256: DIGEST, size: 1, mime: "image/png" },
        "b.png": { sha256: DIGEST, size: 1, mime: "image/png" },
        "c.png": { sha256: OTHER_DIGEST, size: 1, mime: "image/png" },
      },
    });
    expect(digests).toEqual([DIGEST, OTHER_DIGEST]);
  });
});

describe("manifestNameConflicts", () => {
  const manifest: AssetManifest = {
    version: 1,
    assets: {
      "data.json": { sha256: DIGEST, size: 1, mime: "application/json" },
    },
  };

  it("コードのファイルと同じ名前を見つける", () => {
    expect(manifestNameConflicts(manifest, { "data.json": "{}" })).toEqual([
      "data.json",
    ]);
  });

  it("ぶつからなければ空", () => {
    expect(manifestNameConflicts(manifest, { "sketch.js": "" })).toEqual([]);
  });
});
