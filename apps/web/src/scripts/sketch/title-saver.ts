/**
 * 作品の名前を正本へ書き戻す (#41 の 3)。
 *
 * 名前は常時編集できる入力欄なので、打鍵のたびに送ると 1 文字ずつ PATCH が飛ぶ。
 * 手が止まってから 1 度だけ送る。
 *
 * **保存済みの作品だけが対象**。まだ器が無い作品の名前は下書きにしか置き場が
 * なく、初回保存 (`SketchSaver.saveNow`) がその時点の名前を一緒に送る。
 *
 * 失敗しても投げない。名前が書き戻せないことは編集を止める理由にならないので、
 * 伝えるだけにして次の変更でまた試みる。中身の保存 (SketchSaver) と同じ方針。
 */

/** 手が止まってから送るまで。 */
const SAVE_DELAY_MS = 800;

export interface TitleSaverOptions {
  /** 送れなかった。文言は利用者に見せる形にしてある。 */
  onError?(message: string): void;
}

export class TitleSaver {
  readonly #onError: TitleSaverOptions["onError"];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: { sketchId: string; title: string } | null = null;
  /** 最後に送れた名前。同じ値を送り直さないために持つ。 */
  #sent = new Map<string, string>();

  constructor(options: TitleSaverOptions = {}) {
    this.#onError = options.onError;
  }

  /**
   * 名前を書き戻す予約を入れる。
   *
   * 空白だけの名前は送らない。サーバ側は空を既定名へ倒すので (`normalizeTitle`)、
   * 打っている途中に一瞬空になっただけで名前が置き換わってしまう。
   */
  schedule(sketchId: string, title: string): void {
    const trimmed = title.trim();
    if (trimmed === "") return;
    if (this.#sent.get(sketchId) === trimmed) return;

    this.#pending = { sketchId, title: trimmed };
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  /**
   * 「この名前は正本に載っている」ことを覚える。
   *
   * 開いた直後と初回保存の直後に呼ぶ。読んだ名前をそのまま送り返す往復を
   * 省くため。
   */
  markSent(sketchId: string, title: string): void {
    this.#sent.set(sketchId, title.trim());
  }

  /** 予約を待たずに送る。 */
  async flush(): Promise<void> {
    this.#clearTimer();
    const pending = this.#pending;
    if (pending === null) return;
    this.#pending = null;

    try {
      const response = await fetch(
        `/api/sketches/${encodeURIComponent(pending.sketchId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: pending.title }),
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        this.#onError?.(body.message ?? "名前を保存できませんでした");
        return;
      }
      this.#sent.set(pending.sketchId, pending.title);
    } catch {
      this.#onError?.("名前を保存できませんでした。接続を確認してください");
    }
  }

  /** 予約を捨てる (ページを離れるときなど)。 */
  cancelScheduled(): void {
    this.#clearTimer();
    this.#pending = null;
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}
