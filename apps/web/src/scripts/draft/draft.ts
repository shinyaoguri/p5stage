/**
 * ドラフト (保存前の編集内容) の形と検証。
 *
 * Phase 1 には作品の保存先が無く、ブラウザを閉じれば書いたものは消える。
 * ドラフトはその穴を埋めるだけのもので、**正本ではない** (正本は Phase 2 の
 * Gist)。だから復元できない値に出会っても投げず、扱える形へ倒すか捨てる。
 *
 * 検証を設定 (settings.ts) と同じく「壊れているところだけ倒す」方針に揃えてある。
 * ただしファイルの中身だけは倒しようがないので、構造が壊れていれば
 * ドラフト全体を捨てて既定のテンプレートで始める。
 */

import { parseSketchFiles, type SketchFiles } from "@p5stage/shared";

export interface SketchDraft {
  /** 編集中のファイル一式。 */
  readonly files: SketchFiles;
  /** 最後に開いていたファイル。必ず files に含まれる。 */
  readonly activeFile: string;
  /** 書き込んだ時刻 (エポックミリ秒)。復元したことを人に伝えるために持つ。 */
  readonly savedAt: number;
  /**
   * どの作品の下書きか。まだ保存していなければ null。
   *
   * 別の作品を開いたときに、前の作品の下書きをその中身として復元しないために持つ
   * (Phase 2-3)。作品ごとに下書きを持ち分けるのは、作品を切り替える導線ができてから。
   */
  readonly sketchId: string | null;
  /**
   * 作品の名前 (#41 の 3)。読めなければ null。
   *
   * 保存前から名前を持つので (`sketch/project-name.ts` が自動生成する)、下書きにも
   * 入れる。ここに無いと、リロードのたびに別の名前が振られて別の作品に見える。
   */
  readonly title: string | null;
}

/**
 * 素性の知れない値をドラフトとして読み取る。読めなければ null。
 *
 * ファイル構成の検証は `parseSketchFiles` に任せる (エディタ・ランナー・
 * ドラフトで判断が割れないよう、正本は `@p5stage/shared`)。サイズ超過は
 * ここでは弾かない。上限は Gist の制約で、手元の下書きを捨てる理由にはならない。
 */
export function parseDraft(value: unknown): SketchDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;

  const files = parseSketchFiles(source.files);
  if (files === null) return null;

  // 開いていたファイルが消えている (別タブで消した・手で書き換えた) ことは
  // ありうる。ドラフト全体を捨てる理由にはならないので先頭のファイルへ倒す。
  const names = Object.keys(files);
  const activeFile =
    typeof source.activeFile === "string" && names.includes(source.activeFile)
      ? source.activeFile
      : (names[0] as string);

  const savedAt =
    typeof source.savedAt === "number" && Number.isFinite(source.savedAt)
      ? source.savedAt
      : 0;

  // 作品 ID が読めないものは「まだ保存していない下書き」として扱う。保存済みの
  // 作品の中身として復元するより、行き場の無い下書きにしておく方が害が小さい。
  const sketchId =
    typeof source.sketchId === "string" && source.sketchId !== ""
      ? source.sketchId
      : null;

  // 名前が読めないものは「まだ付いていない」として扱う。呼び出し側が自動生成で
  // 埋めるので、下書き全体を捨てる理由にはならない。
  const title =
    typeof source.title === "string" && source.title.trim() !== ""
      ? source.title
      : null;

  return { files, activeFile, savedAt, sketchId, title };
}
