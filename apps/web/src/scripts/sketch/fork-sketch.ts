/**
 * 作品をフォークする側の口 (Phase 4-3)。
 *
 * GitHub を叩くのはサーバ (ADR 0010)。ここが相手にするのは自分のオリジンの口だけで、
 * 持つのは**失敗をその人の次の一手に変えること** (`gist-adopt.ts` と同じ役)。
 */

/** フォークできなかった理由。利用者に見せる文言にする。 */
export class ForkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForkError";
  }
}

interface ForkResponse {
  readonly sketch?: { readonly id?: string };
  readonly message?: string;
}

/** 失敗の応答を、その人が次に何をすればいいか分かる文言にする。 */
async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ForkResponse;
  if (typeof body.message === "string" && body.message !== "") {
    return body.message;
  }
  if (response.status === 401) {
    return "フォークするにはログインが必要です";
  }
  return `フォークできませんでした (${response.status})`;
}

/**
 * フォークして、できた作品の ID を返す。失敗したら理由を持って投げる。
 *
 * **冪等ではない** (押すたびに Gist と作品が増える)。「1 つの作品から 2 つの派生」は
 * 正当な使い方なので口の側では止めず、二度押しは呼び出し側が塞ぐ。
 */
export async function forkSketch(sketchId: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      `/api/sketches/${encodeURIComponent(sketchId)}/fork`,
      { method: "POST", headers: { "Content-Type": "application/json" } }
    );
  } catch {
    throw new ForkError("フォークできませんでした。接続を確認してください");
  }

  if (!response.ok) throw new ForkError(await describeFailure(response));

  const body = (await response.json()) as ForkResponse;
  const id = body.sketch?.id;
  if (typeof id !== "string" || id === "") {
    throw new ForkError("フォークできませんでした (応答を解釈できません)");
  }
  return id;
}
