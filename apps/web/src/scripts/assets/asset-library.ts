/**
 * 持っているアセット (所有) の読み出しと、所有を手放す口 (Phase 3-4b)。
 *
 * 作品のアセット (`assets.json` — manifest-edit.ts) とは**別の物差し**であることに
 * 注意。あちらは「この作品が使うもの」で、ここは「クォータを埋めているもの」。
 * 作品から外しても所有は残るので、この 2 つは一致しない。
 *
 * ここで突き合わせられるのは**今開いている作品**のマニフェストだけ。ほかの作品での
 * 使用はサーバが参照台帳で見て 409 で断る (3-5a) ので、この層で「使っていない」と
 * 決めつけない。画面が出すのは先回りの案内、断りの最終判断はサーバ。
 */

import type { SketchFiles } from "@p5stage/shared";

import type { AssetBlob, AssetUsage } from "../../lib/assets/asset";

import { readManifestState } from "./manifest-edit";

export type { AssetBlob, AssetUsage };

/** 所有一覧とクォータ。 */
export interface AssetLibrary {
  /** 持ち込んだ新しい順 (サーバが返す並び)。 */
  readonly assets: readonly AssetBlob[];
  readonly usage: AssetUsage;
}

/** 一覧に並ぶ所有アセット 1 件。 */
export interface LibraryRow {
  readonly asset: AssetBlob;
  /**
   * 今開いている作品で使っている名前 (使っていなければ空)。
   *
   * 配列なのは、**同じ実体が別の名前で 2 回載ることがある**ため (content-addressed
   * なので、中身が同じなら別の名前で足しても同じ blob を指す)。
   */
  readonly usedAs: readonly string[];
}

/** 手放した結果。断るときは、そのまま画面に出せる文言を持つ。 */
export type ReleaseResult =
  | { readonly ok: true; readonly usage: AssetUsage }
  | { readonly ok: false; readonly message: string };

/**
 * 所有一覧とクォータを引く。ログインしていなければ null。
 *
 * 未ログインを失敗として扱わないのは、**エディタはログイン無しでも使える**ため
 * (要件 3.1)。アセットを持てないだけで、パネルは開いて作品の中身を見られる。
 */
export async function fetchAssetLibrary(): Promise<AssetLibrary | null> {
  try {
    const response = await fetch("/api/assets");
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<AssetLibrary>;
    if (body.usage === undefined) return null;
    return { assets: body.assets ?? [], usage: body.usage };
  } catch {
    return null;
  }
}

/**
 * 所有を手放す。
 *
 * 消えるのは台帳の「誰に計上するか」だけで、実体は残る (回収は 3-5 の GC)。
 * 同じ中身をもう一度落とせば転送なしで戻るが、**手元にその中身が要る**。
 */
export async function releaseAsset(sha256: string): Promise<ReleaseResult> {
  let response: Response;
  try {
    response = await fetch(`/api/assets/${sha256}`, { method: "DELETE" });
  } catch {
    return {
      ok: false,
      message: "削除できませんでした。接続を確認してください",
    };
  }

  const body = (await response.json().catch(() => ({}))) as {
    readonly message?: string;
    readonly usage?: AssetUsage;
  };

  // 断る理由はサーバの文言をそのまま使う (同じ判断を 2 か所に書かない)。
  if (!response.ok) {
    const message = body.message ?? "";
    return {
      ok: false,
      message:
        message === "" ? `削除できませんでした (${response.status})` : message,
    };
  }
  if (body.usage === undefined) {
    return {
      ok: false,
      message: "削除できませんでした (応答を解釈できません)",
    };
  }
  return { ok: true, usage: body.usage };
}

/**
 * 所有一覧に、今の作品での使われ方を添える。
 *
 * 並びはサーバが返した順 (持ち込んだ新しい順) のまま。使用中を先頭へ寄せる形は
 * 採らない — 一覧の順が操作のたびに入れ替わると、**さっき見ていた行がどこへ
 * 行ったか**分からなくなる (作品から外した直後がまさにその形)。
 */
export function libraryRows(
  assets: readonly AssetBlob[],
  files: SketchFiles
): LibraryRow[] {
  const state = readManifestState(files);
  const namesByDigest = new Map<string, string[]>();

  // 読めないマニフェストからは何も導けない。使われ方が空になるだけで、一覧
  // そのものは出す (所有は作品と無関係に存在する)。
  if (state.kind === "ok") {
    for (const { name, entry } of state.assets) {
      const names = namesByDigest.get(entry.sha256);
      if (names === undefined) namesByDigest.set(entry.sha256, [name]);
      else names.push(name);
    }
  }

  return assets.map((asset) => ({
    asset,
    usedAs: namesByDigest.get(asset.sha256) ?? [],
  }));
}
