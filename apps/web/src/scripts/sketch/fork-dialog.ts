/**
 * フォークの確認 (Phase 4-3)。
 *
 * 押した瞬間に**自分の GitHub アカウントに Gist が 1 つでき、作品が 1 件増える**。
 * 作品を消す口はまだ無いので取り消せない。何が起きるかを見せてから進む
 * (`AdoptPanel` と同じ作りで、`.app-dialog` の意匠を共有する)。
 *
 * 公開範囲の断りをここに書くのは、**利用者が選べないから**。fork は元が公開なら
 * 公開の Gist になる (GitHub の制約 — ADR 0010) ので、黙って進めると
 * 「公開は明示的な選択でなければならない」(`normalizeVisibility`) が崩れる。
 */

import "../../styles/dialog.css";

/** フォークを実行する。成功なら null、失敗なら見せる文言を返す。 */
export type ForkRunner = () => Promise<string | null>;

export class ForkDialog {
  readonly #dialog: HTMLDialogElement;
  readonly #proceed = document.createElement("button");
  readonly #error = document.createElement("p");
  readonly #run: ForkRunner;
  #busy = false;

  constructor(run: ForkRunner, isPublic: boolean) {
    this.#run = run;
    this.#dialog = this.#build(isPublic);
    document.body.appendChild(this.#dialog);
  }

  open(): void {
    this.#setError(null);
    this.#dialog.showModal();
  }

  #setError(message: string | null): void {
    this.#error.textContent = message ?? "";
  }

  #setBusy(busy: boolean): void {
    this.#busy = busy;
    this.#proceed.disabled = busy;
    this.#proceed.textContent = busy ? "フォーク中…" : "フォークする";
  }

  /**
   * フォークを試す。
   *
   * 失敗してもダイアログは閉じない。閉じると何が起きたのか読む前に消える。
   */
  async #fork(): Promise<void> {
    // 往復の間に連打されても 2 本走らせない。**この口は冪等ではない**ので、
    // 走らせた数だけ Gist と作品が増える。
    if (this.#busy) return;

    this.#setBusy(true);
    this.#setError(null);
    try {
      const failure = await this.#run();
      if (failure !== null) {
        this.#setError(failure);
        return;
      }
      this.#dialog.close();
    } finally {
      this.#setBusy(false);
    }
  }

  #build(isPublic: boolean): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.id = "fork-dialog";

    const heading = document.createElement("h2");
    heading.textContent = "この作品をフォークする";

    const note = document.createElement("p");
    note.className = "app-note";
    note.textContent =
      "元の作品の最新の版から、あなたの作品として新しく作ります。GitHub にはあなたの Gist ができ、元の Gist からのフォークとして記録されます。" +
      `公開範囲は元の作品を引き継ぐため、この作品は${isPublic ? "公開" : "限定公開"}になります (GitHub の制約で選べません)。`;

    this.#error.className = "app-dialog-error";
    this.#error.setAttribute("role", "alert");

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "やめる";
    cancel.addEventListener("click", () => this.#dialog.close());

    this.#proceed.type = "button";
    this.#proceed.id = "fork-confirm";
    this.#proceed.className = "app-dialog-proceed";
    this.#proceed.textContent = "フォークする";
    this.#proceed.addEventListener("click", () => void this.#fork());

    actions.appendChild(cancel);
    actions.appendChild(this.#proceed);

    dialog.appendChild(heading);
    dialog.appendChild(note);
    dialog.appendChild(this.#error);
    dialog.appendChild(actions);
    return dialog;
  }
}
