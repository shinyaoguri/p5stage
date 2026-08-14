/**
 * 画面上部中央の実行ボタンとプロジェクト名 (#41 の 3)。
 *
 * 移植元は canvastage の `#project-bar`。実行は**編集中に最も多く押す操作**なので、
 * 右上の操作列に混ぜず、中央に単独で置いて狙いやすくする。
 *
 * 状態は文字ではなくアイコンで示す。
 *
 * - 実行中かどうか … ▶ / ■ のトグル
 * - 実行中の表示が古い (実行してから編集した) … ボタン右上の青いドット
 *
 * 名前は常時編集できる `<input>`。下線だけの控えめな見た目にして、スケッチの
 * 上に置いても邪魔にならないようにする。
 */

import "../../styles/project-bar.css";

import {
  makeToolbarButton,
  setToolbarButtonIcon,
  setToolbarButtonLabel,
} from "../ui/toolbar-button";

/**
 * 実行ショートカットの表記。
 *
 * Monaco の割り当てと同じ材料 (`navigator.userAgent`) から引く。実行の keydown は
 * 本体が直接見て ⌘ と Ctrl の両方を受けるが、**表記は 1 つに絞る**方が読みやすい。
 */
function runShortcutLabel(): string {
  return navigator.userAgent.includes("Macintosh") ? "⌘+Enter" : "Ctrl+Enter";
}

export interface ProjectBarOptions {
  /** 実行が押された (止まっているとき)。 */
  onRun(): void;
  /** 停止が押された (動いているとき)。 */
  onStop(): void;
  /** 名前が変わった。打つたびに呼ぶ。 */
  onRename(name: string): void;
}

export class ProjectBar {
  readonly #button: HTMLButtonElement;
  readonly #input: HTMLInputElement;
  readonly #options: ProjectBarOptions;
  #running = false;
  #stale = false;
  /** 空にされたときに戻す名前。 */
  #name = "";

  constructor(host: HTMLElement, options: ProjectBarOptions) {
    this.#options = options;
    host.classList.add("project-bar");

    this.#button = makeToolbarButton({
      id: "run",
      icon: "play",
      label: "実行",
      onClick: () => {
        if (this.#running) this.#options.onStop();
        else this.#options.onRun();
      },
    });
    this.#button.classList.add("run-btn");

    this.#input = document.createElement("input");
    this.#input.type = "text";
    this.#input.id = "project-name";
    this.#input.className = "project-name";
    this.#input.spellcheck = false;
    this.#input.autocomplete = "off";
    this.#input.setAttribute("aria-label", "作品の名前");
    this.#input.addEventListener("input", () => {
      // 覚えるのは**空でない最後の名前**。打ち直すために一度全部消すのは普通の
      // 操作なので、その瞬間の空文字で上書きすると戻す先が無くなる。
      if (this.#input.value.trim() !== "") this.#name = this.#input.value;
      this.#options.onRename(this.name);
    });
    // 空のまま離れると名前の無い作品になる。サーバ側も空を既定名へ倒すので
    // (lib/sketches/sketch.ts の `normalizeTitle`)、画面と食い違わないよう
    // ここでは**離れた時点で**元の名前へ戻す。
    this.#input.addEventListener("blur", () => {
      if (this.#input.value.trim() !== "") return;
      this.#input.value = this.#name;
      this.#options.onRename(this.#name);
    });

    host.replaceChildren(this.#button, this.#input);
    this.#renderButton();
  }

  /**
   * 今の名前。
   *
   * 打ち直しの途中で入力欄が空になっている間は、**空でない最後の名前**を返す。
   * 外へ渡る名前が一瞬でも空になると、下書きにも正本にも名前の無い作品として
   * 書き込まれてしまう。
   */
  get name(): string {
    const value = this.#input.value;
    return value.trim() === "" ? this.#name : value;
  }

  /** 名前を差し替える (読み込み・自動生成・取り込みの後)。onRename は呼ばない。 */
  setName(name: string): void {
    this.#name = name;
    this.#input.value = name;
  }

  /** 動いているかどうか。▶ と ■ が入れ替わる。 */
  setRunning(running: boolean): void {
    if (this.#running === running) return;
    this.#running = running;
    this.#renderButton();
  }

  /**
   * 実行してから編集したかどうか。
   *
   * 止まっている間はこの概念が無い (古い表示というものが無い) ので、ドットは
   * 動いているときだけ出す。
   */
  setStale(stale: boolean): void {
    if (this.#stale === stale) return;
    this.#stale = stale;
    this.#renderButton();
  }

  #renderButton(): void {
    setToolbarButtonIcon(this.#button, this.#running ? "stop" : "play");
    setToolbarButtonLabel(
      this.#button,
      this.#running ? "停止" : `実行 (${runShortcutLabel()})`
    );
    // 「実行中で、かつ実行後に編集した」だけ。止まっているときは出さない。
    this.#button.classList.toggle("is-stale", this.#running && this.#stale);
  }
}
