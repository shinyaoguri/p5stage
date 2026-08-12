/**
 * 外部の Gist を作品として取り込む側の口 (Phase 2-6)。
 *
 * GitHub を叩くのはサーバ (ADR 0010)。ここが相手にするのは自分のオリジンの口だけで、
 * 持つのは**失敗をその人の次の一手に変えること**。
 */

import type { SketchFiles } from "@p5stage/shared";

import type { SavedGist } from "./sketch-saver";

/** 取り込めた作品。 */
export interface AdoptedSketch {
  readonly sketchId: string;
  readonly gist: SavedGist;
  readonly files: SketchFiles;
}

/** 取り込めなかった理由。利用者に見せる文言にする。 */
export class GistAdoptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GistAdoptError";
  }
}

interface AdoptResponse {
  readonly sketch?: { readonly id?: string };
  readonly gist?: SavedGist;
  readonly files?: SketchFiles;
  readonly message?: string;
}

/** 失敗の応答を、その人が次に何をすればいいか分かる文言にする。 */
async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as AdoptResponse;
  if (typeof body.message === "string" && body.message !== "") {
    return body.message;
  }
  if (response.status === 401) {
    return "取り込むにはログインが必要です";
  }
  return `取り込めませんでした (${response.status})`;
}

/** Gist を取り込む。失敗したら理由を持って投げる。 */
export async function adoptGist(ref: string): Promise<AdoptedSketch> {
  let response: Response;
  try {
    response = await fetch("/api/sketches/adopt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gist: ref }),
    });
  } catch {
    throw new GistAdoptError("取り込めませんでした。接続を確認してください");
  }

  if (!response.ok) throw new GistAdoptError(await describeFailure(response));

  const body = (await response.json()) as AdoptResponse;
  const sketchId = body.sketch?.id;
  if (
    typeof sketchId !== "string" ||
    body.gist === undefined ||
    body.files === undefined
  ) {
    throw new GistAdoptError("取り込めませんでした (応答を解釈できません)");
  }

  return { sketchId, gist: body.gist, files: body.files };
}

/** 作品を Gist から切り離す。失敗したら理由を持って投げる。 */
export async function detachSketchGist(sketchId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `/api/sketches/${encodeURIComponent(sketchId)}/detach`,
      { method: "POST", headers: { "Content-Type": "application/json" } }
    );
  } catch {
    throw new GistAdoptError("切り離せませんでした。接続を確認してください");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new GistAdoptError(
      body.message ?? `切り離せませんでした (${response.status})`
    );
  }
}
