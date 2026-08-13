/**
 * アセットの allowlist と sha256 の扱い (Phase 3-1)。
 *
 * ここが緩むと、本体・クライアント・ランナーで「受け付ける形式」の答えがずれる。
 * とくに **SVG / HTML を通さない**ことと、**sha256 の表記を一意に縛る**ことは
 * 守りとして効いているので、境界をテストで固定する。
 */

import { describe, expect, it } from "vitest";

import {
  ASSET_TYPES,
  DEFAULT_ASSET_QUOTA_BYTES,
  DEFAULT_MAX_ASSET_BYTES,
  assetMimeForFileName,
  isAssetFileName,
  isAssetMime,
  isSha256Hex,
  sha256Hex,
} from "../src/assets";

describe("isAssetMime", () => {
  it("要件 3.3 の形式を受け付ける", () => {
    expect(isAssetMime("image/png")).toBe(true);
    expect(isAssetMime("model/gltf-binary")).toBe(true);
    expect(isAssetMime("audio/ogg")).toBe(true);
    expect(isAssetMime("font/ttf")).toBe(true);
  });

  it("SVG と HTML は受け付けない (文書として解釈される形式は入れない)", () => {
    expect(isAssetMime("image/svg+xml")).toBe(false);
    expect(isAssetMime("text/html")).toBe(false);
    expect(isAssetMime("application/xhtml+xml")).toBe(false);
  });

  it("文字列でない値を通さない", () => {
    expect(isAssetMime(undefined)).toBe(false);
    expect(isAssetMime({ toString: () => "image/png" })).toBe(false);
  });
});

describe("assetMimeForFileName", () => {
  it("拡張子から形式を決める", () => {
    expect(assetMimeForFileName("cat.png")).toBe("image/png");
    expect(assetMimeForFileName("model.glb")).toBe("model/gltf-binary");
    expect(assetMimeForFileName("data.csv")).toBe("text/csv");
  });

  it("同じ形式の別表記も拾う", () => {
    expect(assetMimeForFileName("photo.jpeg")).toBe("image/jpeg");
    expect(assetMimeForFileName("photo.jpg")).toBe("image/jpeg");
  });

  it("大文字の拡張子でも同じ答えを出す", () => {
    // 「IMG_0001.PNG」はカメラの既定名なので、ここで落とすと普通の操作が通らない。
    expect(assetMimeForFileName("IMG_0001.PNG")).toBe("image/png");
  });

  it("allowlist の外は null", () => {
    expect(assetMimeForFileName("logo.svg")).toBeNull();
    expect(assetMimeForFileName("sketch.js")).toBeNull();
    expect(assetMimeForFileName("noextension")).toBeNull();
  });

  it("拡張子と紛らわしい名前を形式と見なさない", () => {
    // ".png" で終わらない限り画像ではない。
    expect(assetMimeForFileName("png")).toBeNull();
  });
});

describe("isAssetFileName", () => {
  it("スケッチのテキストファイルとアセットを見分ける", () => {
    expect(isAssetFileName("cat.png")).toBe(true);
    expect(isAssetFileName("index.html")).toBe(false);
  });
});

describe("isSha256Hex", () => {
  const digest = "a".repeat(64);

  it("64 桁の小文字 16 進を通す", () => {
    expect(isSha256Hex(digest)).toBe(true);
  });

  it("大文字は通さない (同じ blob が 2 つのキーで載るのを防ぐ)", () => {
    expect(isSha256Hex("A".repeat(64))).toBe(false);
  });

  it("長さ違い・16 進でない文字・文字列でない値を通さない", () => {
    expect(isSha256Hex("a".repeat(63))).toBe(false);
    expect(isSha256Hex("a".repeat(65))).toBe(false);
    expect(isSha256Hex(`${"a".repeat(63)}z`)).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("既知の値と一致する (空のバイト列)", async () => {
    // 実装を取り替えても答えが変わらないよう、外部で確認できる値で固定する。
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("同じ中身なら同じ、違えば違う", async () => {
    const a = await sha256Hex(new TextEncoder().encode("cat"));
    const b = await sha256Hex(new TextEncoder().encode("cat"));
    const c = await sha256Hex(new TextEncoder().encode("cat "));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(isSha256Hex(a)).toBe(true);
  });
});

describe("既定の上限", () => {
  it("要件 3.3 の値 (1 ファイル 5MB / 合計 250MB) と一致する", () => {
    // マイグレーションの DEFAULT と同じ値であること。ずれると
    // 「画面の案内どおりに上げたのに DB が弾く」が起きる。
    expect(DEFAULT_MAX_ASSET_BYTES).toBe(5242880);
    expect(DEFAULT_ASSET_QUOTA_BYTES).toBe(262144000);
  });
});

describe("ASSET_TYPES", () => {
  it("すべての形式に拡張子が付いている", () => {
    for (const [mime, extensions] of Object.entries(ASSET_TYPES)) {
      expect(extensions.length, mime).toBeGreaterThan(0);
      for (const extension of extensions) {
        expect(extension.startsWith("."), `${mime} ${extension}`).toBe(true);
      }
    }
  });
});
