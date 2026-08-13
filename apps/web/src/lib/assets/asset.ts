/**
 * アセットの型と、外から来る値の検証・クォータの判定。
 *
 * D1 にも R2 にも触らない純ロジックにしてある。クォータの判定をストア層に混ぜると
 * 「どこで弾いたか」が追えなくなり、境界値をテストで固定しにくくなるため。
 */

import { isAssetMime, isSha256Hex, type AssetMime } from "@p5stage/shared";

/** R2 に置いた blob 1 つ。中身そのものは持たない。 */
export interface AssetBlob {
  /** 小文字 16 進の sha256。R2 のキーでもある。 */
  readonly sha256: string;
  readonly size: number;
  readonly mime: AssetMime;
  readonly createdAt: number;
}

/** あるユーザーの使用量と上限。上限はユーザー行が持つ設定値 (要件 3.3)。 */
export interface AssetUsage {
  /** 計上済みの合計バイト数。 */
  readonly bytes: number;
  /** ユーザー合計の上限。 */
  readonly quotaBytes: number;
  /** 1 ファイルの上限。 */
  readonly maxAssetBytes: number;
}

/** アップロードの申告 (claim)。中身を送る前に、これだけを先に投げる。 */
export interface AssetClaim {
  readonly sha256: string;
  readonly size: number;
  readonly mime: AssetMime;
}

/** 申告が受け付けられない理由を持つ。呼び出し側は 400 に変換する。 */
export class AssetInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetInputError";
  }
}

/**
 * 申告を検証する。
 *
 * ここで見るのは**申告の形だけ**で、中身との一致は実体を受け取るときに確かめる。
 * 形が合っていても中身が違う申告は当然あり得るので、この関数を通ったことを
 * 「その blob が正しい」の根拠にしてはいけない。
 */
export function parseAssetClaim(value: unknown): AssetClaim {
  if (typeof value !== "object" || value === null) {
    throw new AssetInputError("本文が不正です");
  }

  const source = value as Record<string, unknown>;

  if (!isSha256Hex(source.sha256)) {
    throw new AssetInputError(
      "sha256 は 64 桁の小文字 16 進で指定してください"
    );
  }
  if (
    typeof source.size !== "number" ||
    !Number.isSafeInteger(source.size) ||
    source.size <= 0
  ) {
    throw new AssetInputError("size は 1 以上の整数で指定してください");
  }
  if (!isAssetMime(source.mime)) {
    throw new AssetInputError("対応していない形式です");
  }

  return { sha256: source.sha256, size: source.size, mime: source.mime };
}

/**
 * 1 ファイルの上限に収まるか。収まるなら null。
 *
 * 真偽値ではなく理由を返すのは、そのまま利用者に見せる文言にするため
 * (`fileNameError` と同じ形)。
 */
export function assetSizeError(size: number, usage: AssetUsage): string | null {
  if (size > usage.maxAssetBytes) {
    return `1 ファイルは ${formatBytes(usage.maxAssetBytes)} までです`;
  }
  return null;
}

/** 合計の上限に収まるか。収まるなら null。 */
export function quotaError(size: number, usage: AssetUsage): string | null {
  if (usage.bytes + size > usage.quotaBytes) {
    const remaining = Math.max(0, usage.quotaBytes - usage.bytes);
    return `保存できる容量が足りません (残り ${formatBytes(remaining)})`;
  }
  return null;
}

/**
 * 利用者に見せるバイト数。
 *
 * 上限が MB 単位で決まっている値なので、1024 で割る側に揃える (5MB の上限が
 * 「5.2MB まで」と表示されると、上限と説明がずれて見える)。
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${round(bytes / (1024 * 1024))}MB`;
  }
  if (bytes >= 1024) {
    return `${round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
