/**
 * 保存の導線 (Phase 2-3)。
 *
 * 初回だけ、タイトルと公開範囲を尋ねる。**公開範囲は後から変えられない**ため
 * (GitHub の Gist は作成後に public / secret を変更できない — ADR 0010)、
 * 選ぶ機会をここに置くしかない。限定公開が private ではないことも同じ画面で見せる
 * (要件 3.4)。
 */

import "../../styles/save-panel.css";

import type { SaveState, SketchMeta } from "./sketch-saver";

const VISIBILITY_LABELS: Record<SketchMeta["visibility"], string> = {
  unlisted: "限定公開 — URL を知っている人だけが見られます",
  public: "公開 — ギャラリーに載り、誰でも見られます",
};

/** 保存できた時刻。実行ボタンと同じ行に出るので月日と分まで。 */
function formatSavedAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describe(state: SaveState): string {
  switch (state.status) {
    case "unsaved":
      return "未保存";
    case "dirty":
      return "未保存の変更があります";
    case "saving":
      return "保存中…";
    case "saved":
      return state.savedAt === null
        ? "保存済み"
        : `保存しました (${formatSavedAt(state.savedAt)})`;
    case "error":
      return state.message ?? "保存できませんでした";
  }
}

export interface SavePanelOptions {
  /** 保存が押された。初回だけ `meta` が付く。 */
  onSave(meta: SketchMeta | null): void;
}

export class SavePanel {
  readonly #host: HTMLElement;
  readonly #onSave: SavePanelOptions["onSave"];
  readonly #button: HTMLButtonElement;
  readonly #status: HTMLElement;
  readonly #link: HTMLAnchorElement;
  readonly #dialog: HTMLDialogElement;
  readonly #titleInput: HTMLInputElement;
  #state: SaveState | null = null;

  constructor(host: HTMLElement, options: SavePanelOptions) {
    this.#host = host;
    this.#onSave = options.onSave;
    this.#host.classList.add("save-panel");

    this.#button = document.createElement("button");
    this.#button.type = "button";
    this.#button.id = "save";
    this.#button.textContent = "保存";
    this.#button.addEventListener("click", () => this.#handleClick());

    this.#status = document.createElement("span");
    this.#status.className = "save-status";
    this.#status.id = "save-status";
    this.#status.setAttribute("role", "status");

    // 保存先を確かめる道。正本が自分の GitHub にあることが目に見えるようにする。
    this.#link = document.createElement("a");
    this.#link.className = "save-gist-link";
    this.#link.target = "_blank";
    this.#link.rel = "noopener noreferrer";
    this.#link.textContent = "Gist";
    this.#link.hidden = true;

    this.#titleInput = document.createElement("input");
    this.#dialog = this.#buildDialog();

    for (const node of [this.#status, this.#link, this.#button, this.#dialog]) {
      this.#host.appendChild(node);
    }
  }

  /** 状態を描き直す。 */
  render(state: SaveState): void {
    this.#state = state;
    this.#status.textContent = describe(state);
    this.#status.classList.toggle(
      "save-status-error",
      state.status === "error"
    );
    this.#button.disabled = state.status === "saving";

    if (state.gist === null) {
      this.#link.hidden = true;
      return;
    }
    this.#link.hidden = false;
    this.#link.href = state.gist.url;
  }

  #handleClick(): void {
    // 2 回目からはそのまま送る。尋ねる必要があるのは初回だけ。
    if (this.#state !== null && this.#state.sketchId !== null) {
      this.#onSave(null);
      return;
    }
    this.#titleInput.value = "";
    this.#dialog.showModal();
  }

  #buildDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "save-dialog";
    dialog.id = "save-dialog";

    const heading = document.createElement("h2");
    heading.textContent = "あなたの Gist に保存します";

    const titleLabel = document.createElement("label");
    titleLabel.className = "save-field";
    titleLabel.textContent = "タイトル";
    this.#titleInput.type = "text";
    this.#titleInput.id = "save-title";
    this.#titleInput.placeholder = "無題のスケッチ";
    this.#titleInput.maxLength = 100;
    titleLabel.appendChild(this.#titleInput);

    const visibility = this.#buildVisibilityChoice();

    const note = document.createElement("p");
    note.className = "save-note";
    note.textContent =
      "公開範囲は保存後に変更できません (GitHub の Gist は作成後に公開範囲を変えられないため)。変えたいときは別の作品として作り直してください。";

    const actions = document.createElement("div");
    actions.className = "save-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "やめる";
    cancel.addEventListener("click", () => dialog.close());

    const proceed = document.createElement("button");
    proceed.type = "button";
    proceed.id = "save-confirm";
    proceed.className = "save-dialog-proceed";
    proceed.textContent = "保存";
    proceed.addEventListener("click", () => {
      const selected = visibility.querySelector<HTMLInputElement>(
        "input[name='visibility']:checked"
      );
      dialog.close();
      this.#onSave({
        title: this.#titleInput.value,
        // 選択が読めないときは限定公開へ倒す。黙って公開になる方向へは倒さない。
        visibility: selected?.value === "public" ? "public" : "unlisted",
      });
    });

    for (const node of [cancel, proceed]) actions.appendChild(node);
    for (const node of [heading, titleLabel, visibility, note, actions]) {
      dialog.appendChild(node);
    }
    return dialog;
  }

  #buildVisibilityChoice(): HTMLElement {
    const group = document.createElement("fieldset");
    group.className = "save-visibility";

    const legend = document.createElement("legend");
    legend.textContent = "公開範囲";
    group.appendChild(legend);

    for (const value of ["unlisted", "public"] as const) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "visibility";
      radio.value = value;
      // 既定は限定公開。指定漏れが公開に倒れると、意図しない公開が黙って起きる。
      radio.defaultChecked = value === "unlisted";

      const text = document.createElement("span");
      text.textContent = VISIBILITY_LABELS[value];

      label.appendChild(radio);
      label.appendChild(text);
      group.appendChild(label);
    }

    return group;
  }
}
