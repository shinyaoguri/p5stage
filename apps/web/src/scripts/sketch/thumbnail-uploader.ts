/**
 * 保存できた版の絵を撮って上げる (Phase 4-4 / ADR 0019)。
 *
 * 撮るのはエディタだけ。作品ページ (閲覧者側) は撮らない — 他人の実行結果が
 * 作者の作品の顔になる経路を作らないため。
 *
 * **失敗は黙って捨てる。** サムネイルは飾りで、撮れないスケッチ (canvas を作らない・
 * 外部画像で汚れた canvas) は普通にある。編集の邪魔になる知らせを出す価値が無い。
 */

import { MAX_THUMBNAIL_BYTES, THUMBNAIL_MIME } from "@p5stage/shared";

export interface ThumbnailUploaderOptions {
  /** 今出ている絵を撮る。撮れなければ null (`PreviewHost.capture`)。 */
  capture(): Promise<Blob | null>;
  /** 差し替えられる送信口 (テスト用)。既定は `fetch`。 */
  send?: typeof fetch;
}

export class ThumbnailUploader {
  readonly #capture: ThumbnailUploaderOptions["capture"];
  readonly #send: typeof fetch;
  /** 上げ終わった版。同じ版を撮り直しても中身は変わらない。 */
  #done: string | null = null;
  /** 撮影から送信までが終わっていない版。二重に走らせない。 */
  #busy = false;

  constructor(options: ThumbnailUploaderOptions) {
    this.#capture = options.capture;
    this.#send = options.send ?? ((...args) => fetch(...args));
  }

  /**
   * その版の絵を撮って上げる。
   *
   * 呼ぶのは保存が着地した瞬間 — **実行 → 間引き保存 → 着地**の順なので、
   * このとき画面に出ているのは保存された中身そのもの。
   */
  async onSaved(sketchId: string, revision: string): Promise<void> {
    if (this.#busy || this.#done === revision) return;
    this.#busy = true;
    try {
      const image = await this.#capture();
      // 撮れなかった。次の保存でまた試すので、`#done` は進めない。
      if (image === null) return;
      if (image.size === 0 || image.size > MAX_THUMBNAIL_BYTES) return;

      const response = await this.#send(
        `/api/sketches/${encodeURIComponent(sketchId)}/thumbnail?rev=${encodeURIComponent(revision)}`,
        {
          method: "POST",
          headers: { "Content-Type": THUMBNAIL_MIME },
          body: image,
        }
      );
      // 断られた理由は追わない。版が進んでいた (409) なら次の保存が撮り直す。
      if (response.ok) this.#done = revision;
    } catch {
      // 回線が切れていても編集は続く。次の保存で撮り直せばよい。
    } finally {
      this.#busy = false;
    }
  }
}
