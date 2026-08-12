/**
 * 外部の Gist を取り込む導線 (Phase 2-6)。
 *
 * 尋ねるのは URL 1 つだけ。タイトルも公開範囲も**Gist の側で既に決まっている**ので
 * (公開範囲は作成後に変えられない — ADR 0010)、こちらで選ばせるものが無い。
 *
 * 取り込むと編集中の内容が置き換わる。押す前にそれが分かるよう、注意書きを
 * ダイアログの中に置く。
 */

import "../../styles/dialog.css";
import "../../styles/adopt-panel.css";

export interface AdoptPanelOptions {
  /**
   * 取り込みが確定した。**成功なら null、失敗なら見せる文言**を返す。
   *
   * 通信はページ側が持つ (取り込めた中身をエディタへ流し込むのはあちらの仕事)。
   * ここは結果を出し分けるだけ。
   */
  onAdopt(ref: string): Promise<string | null>;
}

export class AdoptPanel {
  readonly #onAdopt: AdoptPanelOptions["onAdopt"];
  readonly #dialog: HTMLDialogElement;
  readonly #input: HTMLInputElement;
  readonly #error: HTMLParagraphElement;
  readonly #proceed: HTMLButtonElement;
  #busy = false;

  constructor(host: HTMLElement, options: AdoptPanelOptions) {
    this.#onAdopt = options.onAdopt;
    host.classList.add("adopt-panel");

    this.#input = document.createElement("input");
    this.#error = document.createElement("p");
    this.#proceed = document.createElement("button");
    this.#dialog = this.#buildDialog();

    const open = document.createElement("button");
    open.type = "button";
    open.id = "adopt";
    open.textContent = "Gist から開く";
    open.addEventListener("click", () => this.#open());

    host.appendChild(open);
    host.appendChild(this.#dialog);
  }

  #open(): void {
    this.#input.value = "";
    this.#setError(null);
    this.#dialog.showModal();
    this.#input.focus();
  }

  #setError(message: string | null): void {
    this.#error.textContent = message ?? "";
  }

  #setBusy(busy: boolean): void {
    this.#busy = busy;
    this.#proceed.disabled = busy;
    this.#proceed.textContent = busy ? "取り込み中…" : "取り込む";
  }

  /**
   * 取り込みを試す。
   *
   * 失敗したらダイアログを閉じない。URL の打ち間違いはその場で直せるのが自然で、
   * 閉じてしまうと貼り直しからやり直しになる。
   */
  async #run(): Promise<void> {
    // 往復の間に Enter を連打されても 2 本走らせない (作品が 2 つできる)。
    if (this.#busy) return;

    const ref = this.#input.value.trim();
    if (ref === "") {
      this.#setError("Gist の URL または ID を入力してください");
      return;
    }

    this.#setBusy(true);
    this.#setError(null);
    try {
      const failure = await this.#onAdopt(ref);
      if (failure !== null) {
        this.#setError(failure);
        return;
      }
      this.#dialog.close();
    } finally {
      this.#setBusy(false);
    }
  }

  #buildDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.id = "adopt-dialog";

    const heading = document.createElement("h2");
    heading.textContent = "GitHub の Gist を作品として開く";

    const label = document.createElement("label");
    label.className = "app-field";
    label.textContent = "Gist の URL または ID";
    this.#input.type = "text";
    this.#input.id = "adopt-ref";
    this.#input.placeholder = "https://gist.github.com/<user>/<id>";
    this.#input.autocomplete = "off";
    this.#input.spellcheck = false;
    this.#input.addEventListener("keydown", (event) => {
      // 変換確定の Enter で走らせない。
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      void this.#run();
    });
    label.appendChild(this.#input);

    const note = document.createElement("p");
    note.className = "app-note";
    note.textContent =
      "取り込めるのは自分の Gist だけです。その Gist がこの作品の正本になり、以後の保存はそこへ書き込まれます。編集中の内容は取り込んだ中身に置き換わります。";

    this.#error.className = "app-dialog-error";
    this.#error.setAttribute("role", "alert");
    this.#error.id = "adopt-error";

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "やめる";
    cancel.addEventListener("click", () => this.#dialog.close());

    this.#proceed.type = "button";
    this.#proceed.id = "adopt-confirm";
    this.#proceed.className = "app-dialog-proceed";
    this.#proceed.textContent = "取り込む";
    this.#proceed.addEventListener("click", () => void this.#run());

    for (const node of [cancel, this.#proceed]) actions.appendChild(node);
    for (const node of [heading, label, note, this.#error, actions]) {
      dialog.appendChild(node);
    }
    return dialog;
  }
}
