/**
 * ブラウザからアセットを持ち込む段取り (Phase 3-4)。
 *
 * 手順は 3-1 の口がそう作られている通りに踏む。
 *
 * 1. **中身から sha256 を出す** (`crypto.subtle`)。名前でもタイムスタンプでもなく
 *    中身が鍵なので、同じ素材はどこから来ても同じ blob に着く
 * 2. **申告 (claim) を先に投げる** — 上限もクォータも既にあるかも、答えを持つのは
 *    サーバ。5MB の画像を送り切ってから断られる形にしない。既にあれば転送は丸ごと省く
 * 3. 無いと言われたときだけ実体を送る (PUT)
 *
 * **中身の検証はしない。** 形式はファイル名の拡張子から決めて申告し、中身と
 * 合っているかはサーバの署名検査 (3-1) が見る。ここでも見ると判断が二重になり、
 * 食い違ったときに直しようが無くなる。
 */

import {
  assetMimeForFileName,
  sha256Hex,
  type AssetEntry,
  type AssetMime,
} from "@p5stage/shared";

// クォータの型と表示の桁は、サーバが文言に使うもの (`too_large` / `quota_exceeded`)
// と同じ実装から引く。別に持つと、同じ上限が画面とメッセージで違う数字になる。
import type { AssetUsage } from "../../lib/assets/asset";

export type { AssetUsage };

/** アップロードの結果。断るときは、そのまま画面に出せる文言を持つ。 */
export type UploadResult =
  | {
      readonly ok: true;
      /** 台帳に載った実体。マニフェストにはこの値をそのまま書く。 */
      readonly entry: AssetEntry;
      readonly usage: AssetUsage;
      /** 転送を省いた (同じ中身が既にあった)。 */
      readonly deduped: boolean;
    }
  | { readonly ok: false; readonly message: string };

interface ClaimResponse {
  readonly status?: string;
  readonly asset?: AssetEntry;
  readonly usage?: AssetUsage;
}

interface UploadResponse {
  readonly asset?: AssetEntry;
  readonly usage?: AssetUsage;
}

/** アセットを 1 つ持ち込む。 */
export async function uploadAsset(file: File): Promise<UploadResult> {
  // 形式はファイル名で決める。`File.type` は端末の関連付け次第で空にも嘘にもなり、
  // 空だと「対応していない形式」に化ける (拡張子は利用者が見て直せる)。
  const mime = assetMimeForFileName(file.name);
  if (mime === null) {
    return { ok: false, message: `${file.name} は対応していない形式です` };
  }
  if (file.size === 0) {
    return { ok: false, message: `${file.name} は中身がありません` };
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, message: `${file.name} を読み込めませんでした` };
  }
  const sha256 = await sha256Hex(bytes);

  const claimed = await claim(sha256, bytes.byteLength, mime);
  if (!claimed.ok) return claimed;
  if (claimed.deduped) return claimed;

  return send(sha256, bytes, mime);
}

/** 「この中身はもう有るか」を訊く。有れば転送せずに済む。 */
async function claim(
  sha256: string,
  size: number,
  mime: AssetMime
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha256, size, mime }),
    });
  } catch {
    return offline();
  }

  if (!response.ok)
    return { ok: false, message: await describeFailure(response) };

  const body = (await response.json().catch(() => ({}))) as ClaimResponse;
  const usage = body.usage;
  if (usage === undefined) {
    return {
      ok: false,
      message: "アップロードできませんでした (応答を解釈できません)",
    };
  }
  // まだ無い。実体を送る側へ進む (この時点の entry はまだ台帳に無い)。
  if (body.status !== "stored" || body.asset === undefined) {
    return {
      ok: true,
      entry: placeholder(sha256, size, mime),
      usage,
      deduped: false,
    };
  }
  return { ok: true, entry: body.asset, usage, deduped: true };
}

/** 実体を送る。 */
async function send(
  sha256: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime: AssetMime
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetch(`/api/assets/${sha256}`, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: bytes,
    });
  } catch {
    return offline();
  }

  if (!response.ok)
    return { ok: false, message: await describeFailure(response) };

  const body = (await response.json().catch(() => ({}))) as UploadResponse;
  if (body.asset === undefined || body.usage === undefined) {
    return {
      ok: false,
      message: "アップロードできませんでした (応答を解釈できません)",
    };
  }
  return { ok: true, entry: body.asset, usage: body.usage, deduped: false };
}

/**
 * 申告の段階で使う仮の値。
 *
 * 「まだ無い」と返ったときはこの後 PUT が本物を返すので、外へは出ない。
 * 形を合わせるためだけに作る。
 */
function placeholder(
  sha256: string,
  size: number,
  mime: AssetMime
): AssetEntry {
  return { sha256, size, mime };
}

function offline(): UploadResult {
  return {
    ok: false,
    message: "アップロードできませんでした。接続を確認してください",
  };
}

/**
 * 失敗の応答を、その人が次に何をすればいいか分かる文言にする。
 *
 * サーバの文言 (上限・クォータ・形式の不一致) をそのまま使う。同じ判断を
 * クライアントでも書くと、上限を変えたときに片方だけ古い数字を出す。
 */
async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    readonly message?: string;
  };
  if (typeof body.message === "string" && body.message !== "") {
    return body.message;
  }
  if (response.status === 401) {
    return "ログインが切れました。ログインし直してください";
  }
  return `アップロードできませんでした (${response.status})`;
}
