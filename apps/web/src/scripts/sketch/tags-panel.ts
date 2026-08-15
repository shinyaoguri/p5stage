/**
 * タグを付ける導線 (Phase 5)。
 *
 * タグは作品を主題でつなぐための語で、付けた作品は `/tags/<tag>` に並ぶ。付ける場所を
 * ここ (エディタ) に置いたのは、作品ページが**閲覧者ごとに変わらない HTML** で
 * なければならないため (エッジキャッシュ越しに配られる — ADR 0011)。
 *
 * 尋ねるのはカンマ区切りの 1 行だけ。タグ 1 つずつに入力欄を出す形は、5 個までの
 * 短い並びには重い。
 *
 * **未保存の作品には付けられない。** タグの置き場は D1 で、器ができるまで書き先が
 * 無い (`SavePanel` の初回保存より前)。押せない理由はボタンの `title` が言う。
 */

import "../../styles/dialog.css";
import "../../styles/tags-panel.css";

import {
  formatTagInput,
  parseTagInput,
  TAGS_MAX_COUNT,
  TAG_MAX_LENGTH,
} from "../../lib/sketches/tags";
import { SketchInputError } from "../../lib/sketches/sketch";
import { makeToolbarButton } from "../ui/toolbar-button";

/** 付けられるものの説明 (保存済みの作品を開いているとき)。 */
const RULES_NOTE = `${TAGS_MAX_COUNT} 個まで、1 つ ${TAG_MAX_LENGTH} 文字まで。大文字は小文字に、語の間の空白は - になります。公開している作品はタグの一覧ページに並びます。`;

/**
 * まだ書き先が無いときの説明。
 *
 * **ボタン自体は押せるままにする。** 押せないボタンはマウスだけの人に理由を
 * 伝えられず (操作列のボタンは `title` = 名前と決めてある — `makeToolbarButton`)、
 * 「押しても何も起きない」に見える。開いて理由を読ませる方が短い。
 */
const UNSAVED_NOTE =
  "この作品はまだ保存されていません。タグの置き場は保存した作品なので、先に保存してください。";

export interface TagsPanelOptions {
  /**
   * タグの付け替えが確定した。**成功なら null、失敗なら見せる文言**を返す。
   *
   * 通信はページ側が持つ (`AdoptPanel` と同じ形)。ここは入力を整えて結果を
   * 出し分けるだけ。
   */
  onSave(tags: string[]): Promise<string | null>;
}

export class TagsPanel {
  readonly #onSave: TagsPanelOptions["onSave"];
  readonly #button: HTMLButtonElement;
  readonly #dialog: HTMLDialogElement;
  readonly #input: HTMLInputElement;
  readonly #note: HTMLParagraphElement;
  readonly #error: HTMLParagraphElement;
  readonly #proceed: HTMLButtonElement;
  #tags: string[] = [];
  #saved = false;
  #busy = false;

  constructor(host: HTMLElement, options: TagsPanelOptions) {
    this.#onSave = options.onSave;
    host.classList.add("tags-panel");

    this.#input = document.createElement("input");
    this.#note = document.createElement("p");
    this.#error = document.createElement("p");
    this.#proceed = document.createElement("button");
    this.#dialog = this.#buildDialog();

    this.#button = makeToolbarButton({
      id: "tags",
      icon: "tag",
      label: "タグ",
      onClick: () => this.#open(),
    });

    host.appendChild(this.#button);
    host.appendChild(this.#dialog);
  }

  /**
   * 書き先 (器) があるかどうか。保存の状態が変わるたびにページから呼ばれる。
   *
   * タグと分けてあるのは、**保存でタグが変わるわけではない**ため。ここで一緒に
   * 渡させると、保存のたびに呼び出し側が「今のタグ」を作り直すことになる。
   */
  setSaved(saved: boolean): void {
    this.#saved = saved;
  }

  /** 今のタグ。作品を開いたとき・別の作品に切り替えたときに渡される。 */
  setTags(tags: readonly string[]): void {
    this.#tags = [...tags];
  }

  #open(): void {
    this.#input.value = formatTagInput(this.#tags);
    // 書き先が無ければ、開いた先で理由を読ませて書かせない。
    this.#input.disabled = !this.#saved;
    this.#proceed.disabled = !this.#saved;
    this.#note.textContent = this.#saved ? RULES_NOTE : UNSAVED_NOTE;
    this.#setError(null);
    this.#dialog.showModal();
    if (this.#saved) this.#input.focus();
  }

  #setError(message: string | null): void {
    this.#error.textContent = message ?? "";
  }

  #setBusy(busy: boolean): void {
    this.#busy = busy;
    this.#proceed.disabled = busy;
    this.#proceed.textContent = busy ? "保存中…" : "保存";
  }

  /**
   * 付け替えを送る。
   *
   * 形の検査はここでも通す (`parseTagInput`)。サーバも同じ規則で見るが、往復する前に
   * 直せる方が速い — 規則そのものは 1 か所 (`lib/sketches/tags.ts`) にあるので、
   * 2 度見ても食い違わない。
   */
  async #run(): Promise<void> {
    if (this.#busy) return;

    let tags: string[];
    try {
      tags = parseTagInput(this.#input.value);
    } catch (error) {
      if (!(error instanceof SketchInputError)) throw error;
      this.#setError(error.message);
      return;
    }

    this.#setBusy(true);
    this.#setError(null);
    try {
      const failure = await this.#onSave(tags);
      if (failure !== null) {
        // 失敗したらダイアログを閉じない。打ち直しがその場でできる。
        this.#setError(failure);
        return;
      }
      this.#tags = tags;
      this.#dialog.close();
    } finally {
      this.#setBusy(false);
    }
  }

  #buildDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.id = "tags-dialog";

    const heading = document.createElement("h2");
    heading.textContent = "タグ";

    const label = document.createElement("label");
    label.className = "app-field";
    label.textContent = "カンマ区切りで入力";
    this.#input.type = "text";
    this.#input.id = "tags-input";
    this.#input.placeholder = "generative, 3d, 実験";
    this.#input.autocomplete = "off";
    this.#input.spellcheck = false;
    this.#input.addEventListener("keydown", (event) => {
      // 変換確定の Enter で送らない (日本語のタグを打っている最中に確定する)。
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      void this.#run();
    });
    label.appendChild(this.#input);

    // 文面は開くたびに決まる (書き先があるかで変わる — `#open`)。
    this.#note.className = "app-note";
    this.#note.id = "tags-note";

    this.#error.className = "app-dialog-error";
    this.#error.setAttribute("role", "alert");
    this.#error.id = "tags-error";

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "やめる";
    cancel.addEventListener("click", () => dialog.close());

    this.#proceed.type = "button";
    this.#proceed.id = "tags-confirm";
    this.#proceed.className = "app-dialog-proceed";
    this.#proceed.textContent = "保存";
    this.#proceed.addEventListener("click", () => void this.#run());

    for (const node of [cancel, this.#proceed]) actions.appendChild(node);
    for (const node of [heading, label, this.#note, this.#error, actions]) {
      dialog.appendChild(node);
    }
    return dialog;
  }
}
