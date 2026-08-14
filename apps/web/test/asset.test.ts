/**
 * アセットの申告の検証とクォータの判定 (Phase 3-1)。
 *
 * ここが緩むと、上限を超えて置ける・存在しない形式が台帳に載る、といった
 * 「後から直せない状態」がそのまま R2 と D1 に残る。境界値を固定しておく。
 */

import { describe, expect, it } from "vitest";

import {
  AssetInputError,
  assetSizeError,
  formatBytes,
  inUseError,
  parseAssetClaim,
  quotaError,
  type AssetUsage,
} from "../src/lib/assets/asset";

const DIGEST = "b".repeat(64);

const USAGE: AssetUsage = {
  bytes: 0,
  quotaBytes: 1000,
  maxAssetBytes: 100,
};

describe("parseAssetClaim", () => {
  it("正しい申告をそのまま通す", () => {
    expect(
      parseAssetClaim({ sha256: DIGEST, size: 12, mime: "image/png" })
    ).toEqual({ sha256: DIGEST, size: 12, mime: "image/png" });
  });

  it("余計な項目は落とす (台帳に入る値を申告で増やさせない)", () => {
    const claim = parseAssetClaim({
      sha256: DIGEST,
      size: 12,
      mime: "image/png",
      createdAt: 1,
    });

    expect(Object.keys(claim).sort()).toEqual(["mime", "sha256", "size"]);
  });

  it("sha256 の形が違えば断る", () => {
    expect(() =>
      parseAssetClaim({ sha256: "abc", size: 1, mime: "image/png" })
    ).toThrow(AssetInputError);
    expect(() =>
      parseAssetClaim({ sha256: "B".repeat(64), size: 1, mime: "image/png" })
    ).toThrow(AssetInputError);
  });

  it("size は 1 以上の整数だけ", () => {
    for (const size of [0, -1, 1.5, Number.NaN, "12"]) {
      expect(() =>
        parseAssetClaim({ sha256: DIGEST, size, mime: "image/png" })
      ).toThrow(AssetInputError);
    }
  });

  it("allowlist の外の形式は断る", () => {
    expect(() =>
      parseAssetClaim({ sha256: DIGEST, size: 1, mime: "image/svg+xml" })
    ).toThrow(AssetInputError);
  });

  it("オブジェクトでない本文を断る", () => {
    expect(() => parseAssetClaim(null)).toThrow(AssetInputError);
    expect(() => parseAssetClaim("cat.png")).toThrow(AssetInputError);
  });
});

describe("assetSizeError", () => {
  it("上限ちょうどは通す", () => {
    expect(assetSizeError(100, USAGE)).toBeNull();
  });

  it("1 バイトでも超えたら理由を返す", () => {
    expect(assetSizeError(101, USAGE)).toContain("1 ファイル");
  });

  it("上限はユーザーごとの設定値を見る (定数ではない)", () => {
    // 有料プランで引き上げられる構造 (要件 3.3) が壊れていないこと。
    expect(assetSizeError(101, { ...USAGE, maxAssetBytes: 200 })).toBeNull();
  });
});

describe("quotaError", () => {
  it("合計が上限ちょうどに収まるなら通す", () => {
    expect(quotaError(100, { ...USAGE, bytes: 900 })).toBeNull();
  });

  it("超える分は断り、残りを伝える", () => {
    const reason = quotaError(101, { ...USAGE, bytes: 900 });

    expect(reason).toContain("容量");
    expect(reason).toContain("残り");
  });

  it("既に上限を超えていても残りを負の数で見せない", () => {
    const reason = quotaError(1, { ...USAGE, bytes: 1200 });

    expect(reason).not.toContain("-");
  });
});

describe("inUseError", () => {
  it("どの作品も使っていなければ手放せる", () => {
    expect(inUseError([])).toBeNull();
  });

  it("1 件なら作品の名前だけを出す", () => {
    const reason = inUseError(["夏のスケッチ"]);

    expect(reason).toContain("夏のスケッチ");
    expect(reason).not.toContain("ほか");
  });

  it("複数なら 1 件目と残りの件数を出す", () => {
    const reason = inUseError(["夏のスケッチ", "冬のスケッチ", "春のスケッチ"]);

    expect(reason).toContain("夏のスケッチ");
    expect(reason).toContain("ほか 2 件");
    // 2 件目以降は名前を挙げない (ドロワーの幅で読めなくなる)。
    expect(reason).not.toContain("冬のスケッチ");
  });

  it("名前を付けていない作品でも空の鉤括弧にしない", () => {
    expect(inUseError(["   "])).toContain("無題のスケッチ");
  });
});

describe("formatBytes", () => {
  it("上限の表示が設定値と噛み合う", () => {
    // 1024 で割る側に揃える。5MB の上限が「5.2MB まで」と出ると案内がずれる。
    expect(formatBytes(5 * 1024 * 1024)).toBe("5MB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250MB");
  });

  it("小さい値は KB / B で見せる", () => {
    expect(formatBytes(2048)).toBe("2KB");
    expect(formatBytes(512)).toBe("512B");
  });
});
