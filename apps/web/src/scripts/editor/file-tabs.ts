/**
 * ファイルタブ (要件 3.2 のマルチファイル編集の入口)。
 *
 * スケッチの上に重なる UI なので、面をできるだけ張らずに文字と枠線だけで見せる。
 * 追加とリネームはタブの位置でそのまま入力させる (別のダイアログを開くと、
 * 透過エディタの上に不透明な面が乗って下のスケッチが隠れる)。
 *
 * 操作の可否判定は file-actions.ts の純関数に寄せてあり、ここは DOM と
 * 入力の取り回しだけを持つ。
 */

import "../../styles/file-tabs.css";
import {
  checkAddFile,
  checkRemoveFile,
  checkRenameFile,
  isProtectedFile,
  suggestFileName,
} from "./file-actions";

export interface SelectOptions {
  /**
   * 選んだ後に編集へ移るか。
   *
   * クリックや Enter は「このファイルを編集する」意思表示なのでエディタへ移り、
   * 左右キーはタブを見比べているだけなのでフォーカスをタブに残す。
   */
  readonly moveFocusToEditor: boolean;
}

export interface FileTabsOptions {
  /** タブが選ばれた。 */
  onSelect(fileName: string, options: SelectOptions): void;
  /** 追加が確定した (名前は検証済み)。 */
  onAdd(fileName: string): void;
  /** リネームが確定した (名前は検証済み)。 */
  onRename(fileName: string, newName: string): void;
  /** 削除が確定した。 */
  onRemove(fileName: string): void;
  /** 操作を受け付けなかった理由。ステータス表示に流す。 */
  onError(message: string): void;
}

/** 入力中の状態。null なら通常表示。 */
type Editing =
  | { readonly kind: "add" }
  | { readonly kind: "rename"; readonly fileName: string }
  | null;

export class FileTabs {
  readonly #container: HTMLElement;
  readonly #options: FileTabsOptions;
  #fileNames: readonly string[] = [];
  #activeFile = "";
  #editing: Editing = null;
  /** 入力欄を出した直後だけフォーカスを当てる (再描画のたびに奪わない)。 */
  #focusInput = false;
  /** 左右キーで移った直後だけ、描き直した後のタブにフォーカスを戻す。 */
  #focusActiveTab = false;

  constructor(container: HTMLElement, options: FileTabsOptions) {
    this.#container = container;
    this.#options = options;
    this.#container.classList.add("file-tabs");
    this.#container.setAttribute("role", "tablist");
    this.#container.setAttribute("aria-label", "ファイル");
  }

  /** 現在のファイル構成で描き直す。 */
  render(fileNames: readonly string[], activeFile: string): void {
    this.#fileNames = [...fileNames];
    this.#activeFile = activeFile;
    // 名前を変えている途中にそのファイルが消えたら入力も畳む。
    if (
      this.#editing?.kind === "rename" &&
      !this.#fileNames.includes(this.#editing.fileName)
    ) {
      this.#editing = null;
    }
    this.#draw();
  }

  dispose(): void {
    this.#container.replaceChildren();
  }

  #draw(): void {
    const editing = this.#editing;
    const children: HTMLElement[] = [];

    for (const fileName of this.#fileNames) {
      children.push(
        editing?.kind === "rename" && editing.fileName === fileName
          ? this.#createInputTab(fileName)
          : this.#createTab(fileName)
      );
    }
    if (editing?.kind === "add") {
      children.push(this.#createInputTab(suggestFileName(this.#fileNames)));
    }
    children.push(this.#createAddButton());

    this.#container.replaceChildren(...children);

    if (this.#focusInput) {
      this.#focusInput = false;
      const input = this.#container.querySelector("input");
      input?.focus();
      // 拡張子まで選ばれていると打ち直しが速い。
      input?.select();
    } else if (this.#focusActiveTab) {
      this.#focusActiveTab = false;
      this.#container
        .querySelector<HTMLElement>(".file-tab.is-active")
        ?.focus();
    }
  }

  #createTab(fileName: string): HTMLElement {
    const isActive = fileName === this.#activeFile;
    const tab = document.createElement("div");
    tab.className = isActive ? "file-tab is-active" : "file-tab";
    tab.dataset.file = fileName;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(isActive));
    // タブ内をひとつだけ Tab キーの止まり先にし、左右キーで移る (roving tabindex)。
    tab.tabIndex = isActive ? 0 : -1;
    tab.title = isProtectedFile(fileName)
      ? `${fileName} (実行の起点。名前の変更・削除はできません)`
      : `${fileName} (F2 で名前変更、Delete で削除)`;

    const name = document.createElement("span");
    name.className = "file-tab-name";
    name.textContent = fileName;
    tab.appendChild(name);

    if (!isProtectedFile(fileName)) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "file-tab-remove";
      remove.tabIndex = -1;
      remove.setAttribute("aria-label", `${fileName} を削除`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        this.#remove(fileName);
      });
      tab.appendChild(remove);
    }

    tab.addEventListener("click", () => {
      this.#cancelEditing();
      this.#options.onSelect(fileName, { moveFocusToEditor: true });
    });
    tab.addEventListener("dblclick", () => this.#startRename(fileName));
    tab.addEventListener("keydown", (event) => this.#onTabKeyDown(event));
    return tab;
  }

  #createAddButton(): HTMLElement {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "file-tab-add";
    add.title = "ファイルを追加";
    add.setAttribute("aria-label", "ファイルを追加");
    add.textContent = "+";
    add.addEventListener("click", () => {
      this.#editing = { kind: "add" };
      this.#focusInput = true;
      this.#draw();
    });
    return add;
  }

  /** 入力中のタブ。追加とリネームで同じ見た目にする。 */
  #createInputTab(value: string): HTMLElement {
    const tab = document.createElement("div");
    tab.className = "file-tab is-editing";

    const input = document.createElement("input");
    input.className = "file-tab-input";
    input.type = "text";
    input.value = value;
    input.spellcheck = false;
    input.autocapitalize = "off";
    input.setAttribute("aria-label", "ファイル名");

    // Escape で取り消した後の blur が二重に確定させないようにする。
    let settled = false;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        settled = this.#commit(input.value, { viaBlur: false });
      } else if (event.key === "Escape") {
        event.preventDefault();
        settled = true;
        this.#cancelEditing();
      }
      // ← → は入力のカーソル移動なので、タブ移動には使わせない。
      event.stopPropagation();
    });
    input.addEventListener("blur", () => {
      if (settled) return;
      settled = true;
      this.#commit(input.value, { viaBlur: true });
    });

    tab.appendChild(input);
    return tab;
  }

  #onTabKeyDown(event: KeyboardEvent): void {
    const fileName = (event.currentTarget as HTMLElement).dataset.file;
    if (fileName === undefined) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.#options.onSelect(fileName, { moveFocusToEditor: true });
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      this.#startRename(fileName);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.#remove(fileName);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const index = this.#fileNames.indexOf(fileName);
      const step = event.key === "ArrowLeft" ? -1 : 1;
      const next = this.#fileNames[index + step];
      if (next === undefined) return;
      this.#focusActiveTab = true;
      this.#options.onSelect(next, { moveFocusToEditor: false });
    }
  }

  #startRename(fileName: string): void {
    const error = checkRenameFile(fileName, fileName, this.#fileNames);
    if (error !== null) {
      this.#options.onError(error);
      return;
    }
    // onSelect は呼び出し側から render を呼び戻すので、入力中の印を先に立てておく。
    // フォーカスはその再描画では当てず、最後の #draw() で当てる。
    this.#editing = { kind: "rename", fileName };
    // 名前を変えるファイルを開いておく (編集対象と表示のずれを作らない)。
    if (fileName !== this.#activeFile) {
      this.#options.onSelect(fileName, { moveFocusToEditor: false });
    }
    this.#focusInput = true;
    this.#draw();
  }

  #remove(fileName: string): void {
    const error = checkRemoveFile(fileName, this.#fileNames);
    if (error !== null) {
      this.#options.onError(error);
      return;
    }
    this.#cancelEditing();
    this.#options.onRemove(fileName);
  }

  #cancelEditing(): void {
    if (this.#editing === null) return;
    this.#editing = null;
    this.#draw();
  }

  /**
   * 入力を確定する。確定または取り消しで決着したら true。
   *
   * 名前が不正なとき、Enter は入力を残して直させ、フォーカスが外れたときは
   * 取り消す (面が残り続けると下のスケッチを隠すため)。
   */
  #commit(value: string, options: { viaBlur: boolean }): boolean {
    const editing = this.#editing;
    if (editing === null) return true;

    const name = value.trim();
    const reject = (message: string): boolean => {
      this.#options.onError(message);
      if (options.viaBlur) {
        this.#cancelEditing();
        return true;
      }
      return false;
    };

    if (editing.kind === "add") {
      if (name === "") {
        this.#cancelEditing();
        return true;
      }
      const error = checkAddFile(name, this.#fileNames);
      if (error !== null) return reject(error);
      this.#editing = null;
      this.#options.onAdd(name);
      return true;
    }

    if (name === "" || name === editing.fileName) {
      this.#cancelEditing();
      return true;
    }
    const error = checkRenameFile(editing.fileName, name, this.#fileNames);
    if (error !== null) return reject(error);
    this.#editing = null;
    this.#options.onRename(editing.fileName, name);
    return true;
  }
}
