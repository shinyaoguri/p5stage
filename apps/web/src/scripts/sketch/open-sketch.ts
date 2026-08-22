/**
 * 保存済みの作品を開き直す (Phase 2-3)。
 *
 * エディタが起動時に見るものは 3 つある — URL の作品 ID、手元の下書き
 * (IndexedDB)、Gist に保存された中身。**どれを採るか**の判断だけを純ロジックに
 * 切り出してあり (`chooseStartingPoint`)、取得はその外側。
 */

import { DEFAULT_SKETCH_FILES, type SketchFiles } from "@p5stage/shared";

import { SKETCH_PARAM } from "../../lib/sketches/content";
import type { SketchDraft } from "../draft/draft";
import type { SavedGist } from "./sketch-saver";

/** 開き直すときに最初に見せるファイル。 */
const PREFERRED_ACTIVE_FILE = "sketch.js";

export function sketchIdFromUrl(search: string): string | null {
  const id = new URLSearchParams(search).get(SKETCH_PARAM);
  return id === null || id === "" ? null : id;
}

/**
 * URL に作品 ID を載せる。
 *
 * 履歴は積まない。保存は「別のページへ移った」ではないので、戻るで保存前の URL に
 * 戻れてしまうと、同じ作品を新規として二重に保存できてしまう。
 */
export function showSketchIdInUrl(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(SKETCH_PARAM, id);
  window.history.replaceState(null, "", url.href);
}

/** URL から作品 ID を外す (新規に始めるとき)。 */
export function clearSketchIdInUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(SKETCH_PARAM);
  window.history.replaceState(null, "", url.href);
}

export interface OpenedSketch {
  readonly gist: SavedGist | null;
  /** Gist から読んだ中身。まだ一度も保存していなければ null。 */
  readonly files: SketchFiles | null;
  /** 大きすぎて中身を取れなかったファイル名。 */
  readonly truncated: readonly string[];
  /** 付いている名前 (#41 の 3)。応答に無ければ null。 */
  readonly title: string | null;
  /** 付いているタグ (Phase 5)。無ければ空。 */
  readonly tags: readonly string[];
  /**
   * 配信が断った版 (#70)。GitHub 側の編集が反映されていないときだけ入る。
   *
   * 断りは背景処理 (再検証) が下すので、**作者はここでしか気付けない**。
   * 作品ページには出せない (エッジキャッシュを閲覧者全員と共有するため)。
   */
  readonly blockedRevision: string | null;
}

/** 作品を開けなかった理由。利用者に見せる文言にする。 */
export class SketchLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SketchLoadError";
  }
}

/** 保存済みの中身を読む。読めなければ理由を持って投げる。 */
export async function loadSketch(id: string): Promise<OpenedSketch> {
  let response: Response;
  try {
    response = await fetch(`/api/sketches/${encodeURIComponent(id)}/files`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new SketchLoadError(
      "作品を読み込めませんでした (接続を確認してください)"
    );
  }

  if (response.status === 401) {
    throw new SketchLoadError("この作品を開くにはログインが必要です");
  }
  if (response.status === 404) {
    throw new SketchLoadError("作品が見つかりません");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new SketchLoadError(body.message ?? "作品を読み込めませんでした");
  }

  const body = (await response.json()) as {
    gist?: SavedGist | null;
    files?: SketchFiles | null;
    truncated?: string[];
    sketch?: {
      title?: string;
      deliveryBlockedAt?: number | null;
      deliveryBlockedRevision?: string | null;
    } | null;
    tags?: unknown;
  };
  const title = body.sketch?.title;
  // 印が立っていない (= null) 間は版も見ない。**時刻の方が印**で、版はその理由を
  // 指す添え物なので、片方だけ残った応答を「断られている」と読まない。
  const blocked = body.sketch?.deliveryBlockedAt;
  const blockedRevision =
    typeof blocked === "number" ? body.sketch?.deliveryBlockedRevision : null;
  return {
    gist: body.gist ?? null,
    files: body.files ?? null,
    truncated: body.truncated ?? [],
    title: typeof title === "string" && title !== "" ? title : null,
    // 応答の形を信じ切らない (他の項目と同じ扱い)。読めなければタグ無しとして開く。
    tags: Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    blockedRevision:
      typeof blockedRevision === "string" && blockedRevision !== ""
        ? blockedRevision
        : null,
  };
}

export interface StartingPointInput {
  /** URL が指している作品。無ければ新規。 */
  readonly sketchId: string | null;
  readonly draft: SketchDraft | null;
  /** Gist から読んだ中身。読めなかった・保存前なら null。 */
  readonly remoteFiles: SketchFiles | null;
}

export interface StartingPoint {
  readonly files: SketchFiles;
  readonly activeFile: string;
  /** どこから来た内容か。人への知らせを変えるために持つ。 */
  readonly source: "draft" | "sketch" | "default";
}

/** 最初に見せるファイル。`sketch.js` があればそれ、無ければ先頭。 */
export function preferredActiveFile(files: SketchFiles): string {
  const names = Object.keys(files);
  return names.includes(PREFERRED_ACTIVE_FILE)
    ? PREFERRED_ACTIVE_FILE
    : (names[0] ?? PREFERRED_ACTIVE_FILE);
}

/**
 * 何から始めるかを決める。
 *
 * 下書きは**その作品のものであるときだけ**採る。下書きは保存より新しい可能性が
 * あるので、同じ作品なら下書きが勝つ。別の作品のものを持ち込むと、開いた作品の
 * 中身が黙って別物に置き換わり、そのまま保存すると上書きしてしまう。
 */
export function chooseStartingPoint(input: StartingPointInput): StartingPoint {
  const { sketchId, draft, remoteFiles } = input;

  if (draft !== null && draft.sketchId === sketchId) {
    return {
      files: draft.files,
      activeFile: draft.activeFile,
      source: "draft",
    };
  }
  if (remoteFiles !== null) {
    return {
      files: remoteFiles,
      activeFile: preferredActiveFile(remoteFiles),
      source: "sketch",
    };
  }
  return {
    files: DEFAULT_SKETCH_FILES,
    activeFile: PREFERRED_ACTIVE_FILE,
    source: "default",
  };
}
