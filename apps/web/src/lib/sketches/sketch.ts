/**
 * 作品 (スケッチ) のメタデータと、外から来る値の検証。
 *
 * コードそのものは作者自身の Gist が正本で、ここには出てこない (ADR 0002)。
 * この層は D1 にも DOM にも触らない純ロジックにしてある。
 */

/**
 * 公開範囲 (要件 3.4)。
 *
 * `unlisted` は **secret gist** であって private ではない。「URL を知る人は誰でも
 * 見られる」ことを画面でも明示する必要がある。
 */
export const VISIBILITIES = ["public", "unlisted"] as const;

export type Visibility = (typeof VISIBILITIES)[number];

/** 作品 1 件。 */
export interface Sketch {
  readonly id: string;
  readonly ownerId: number;
  /** Gist の ID。器だけ作って中身をまだ書き出していない間は null。 */
  readonly gistId: string | null;
  readonly title: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * 配信するリビジョン (Gist の SHA)。R2 のキーになる (ADR 0011)。
   * まだ書き出していない間は null。
   */
  readonly currentRevision: string | null;
  /** 最後に GitHub と突き合わせたときの ETag。条件付き GET に使う。 */
  readonly revisionEtag: string | null;
  /** 最後に突き合わせた時刻。 */
  readonly revisionCheckedAt: number | null;
  /** 作者が GitHub 側で Gist を消した時刻 (要件 6 の tombstone)。 */
  readonly gistDeletedAt: number | null;
  /**
   * 派生元の作品 (Phase 4-3 / #44)。フォークで作られた作品だけが持つ。
   *
   * GitHub の `Forked from` は経路によって付かない (自分の Gist は fork できない)
   * ので、**系譜はこちらが正典**。
   */
  readonly forkedFromSketchId: string | null;
  /** 派生した時点で親が配っていたリビジョン。新しい Gist 自身の SHA ではない。 */
  readonly forkedFromRevision: string | null;
  /**
   * サムネイルが撮れている版 (Phase 4-4 / ADR 0019)。
   *
   * `currentRevision` と同じとは限らない — 撮れないスケッチもあるので、最後に
   * 撮れた版を指したままになる。実体は `thumbs/<gistId>/<revision>.png`。
   */
  readonly thumbnailRevision: string | null;
}

/** 派生の出どころ。作品を作るときに一緒に刻む。 */
export interface SketchLineage {
  readonly sketchId: string;
  readonly revision: string;
}

/** 作品と、その作者の見せる情報。作品ページが要るのはこの形。 */
export interface SketchWithOwner extends Sketch {
  readonly ownerLogin: string;
  readonly ownerAvatarUrl: string | null;
}

/** タイトルの上限。Gist のファイル名にも使うので、極端に長い値を持ち込ませない。 */
export const TITLE_MAX_LENGTH = 100;

/** 説明の上限。作品ページに出る程度の長さに留める。 */
export const DESCRIPTION_MAX_LENGTH = 2000;

/** タイトルが空のときに使う名前。名前を付けずに保存できるようにするため。 */
export const DEFAULT_TITLE = "無題のスケッチ";

/** 入力が受け付けられなかった理由。利用者に見せる文言にする。 */
export class SketchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SketchInputError";
  }
}

export function isVisibility(value: unknown): value is Visibility {
  return (
    typeof value === "string" && VISIBILITIES.includes(value as Visibility)
  );
}

/**
 * タイトルを整える。
 *
 * 前後の空白を落とし、空なら既定の名前にする。改行は 1 行の表示を崩すので空白に潰す
 * (弾くのではなく直す — 貼り付けで改行が混ざるのは普通のことなので)。
 */
export function normalizeTitle(value: unknown): string {
  if (value === undefined || value === null) return DEFAULT_TITLE;
  if (typeof value !== "string") {
    throw new SketchInputError("タイトルは文字列で指定してください");
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return DEFAULT_TITLE;
  if (collapsed.length > TITLE_MAX_LENGTH) {
    throw new SketchInputError(
      `タイトルは ${TITLE_MAX_LENGTH} 文字以内にしてください`
    );
  }
  return collapsed;
}

/** 説明を整える。改行は意味を持つので残し、前後の空白だけ落とす。 */
export function normalizeDescription(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new SketchInputError("説明は文字列で指定してください");
  }

  const trimmed = value.trim();
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    throw new SketchInputError(
      `説明は ${DESCRIPTION_MAX_LENGTH} 文字以内にしてください`
    );
  }
  return trimmed;
}

/**
 * 公開範囲を読む。
 *
 * 既定は `unlisted`。**公開は明示的な選択でなければならない** (黙って公開になる方向へ
 * 倒さない)。
 */
export function normalizeVisibility(value: unknown): Visibility {
  if (value === undefined || value === null) return "unlisted";
  if (!isVisibility(value)) {
    throw new SketchInputError("公開範囲の指定が不正です");
  }
  return value;
}

/** 新規作成で受け取る値。 */
export interface SketchInput {
  readonly title: string;
  readonly description: string;
  readonly visibility: Visibility;
}

/** 外から来た JSON を、作成に使える形へ整える。 */
export function parseSketchInput(body: unknown): SketchInput {
  if (typeof body !== "object" || body === null) {
    throw new SketchInputError("本文が不正です");
  }

  const source = body as Record<string, unknown>;
  return {
    title: normalizeTitle(source.title),
    description: normalizeDescription(source.description),
    visibility: normalizeVisibility(source.visibility),
  };
}

/** 更新で受け取る値。指定されたものだけを差し替える。 */
export interface SketchPatch {
  readonly title?: string;
  readonly description?: string;
  readonly visibility?: Visibility;
}

/**
 * 外から来た JSON を、更新に使える形へ整える。
 *
 * **キーが無いこと**と **null が入っていること**を区別する。前者は「触らない」、
 * 後者は「既定に戻す」の意味になる。
 */
export function parseSketchPatch(body: unknown): SketchPatch {
  if (typeof body !== "object" || body === null) {
    throw new SketchInputError("本文が不正です");
  }

  const source = body as Record<string, unknown>;
  const patch: {
    title?: string;
    description?: string;
    visibility?: Visibility;
  } = {};

  if ("title" in source) patch.title = normalizeTitle(source.title);
  if ("description" in source) {
    patch.description = normalizeDescription(source.description);
  }
  if ("visibility" in source) {
    patch.visibility = normalizeVisibility(source.visibility);
  }

  if (Object.keys(patch).length === 0) {
    throw new SketchInputError("変更する項目がありません");
  }
  return patch;
}
