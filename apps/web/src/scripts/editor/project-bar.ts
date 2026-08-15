/**
 * 画面上部中央の実行ボタンとプロジェクト名 (#41 の 3)。
 *
 * 移植元は canvastage の `#project-bar`。実行は**編集中に最も多く押す操作**なので、
 * 右上の操作列に混ぜず、中央に単独で置いて狙いやすくする。
 *
 * 状態は文字ではなくアイコンで示す (#41 の 6)。`実行 #3` / `停止しました` の
 * ような文字はここに畳んだ。
 *
 * - 動いていない … ▶ (押すと実行)
 * - 動いていて、実行してから編集した … ▶ + 青いドット (押すと再実行)
 * - 動いていて、画面の中身が今のコードのまま … ■ (押すと停止)
 *
 * **止まらない道は作らない。** 押した先が再実行に変わるのは「実行すべきものが
 * ある」間だけで、実行してしまえば ■ に戻る。
 *
 * 実行の**世代**は `data-generation` に載せる。文字を消しても、往復の
 * ハンドシェイクが通ったことを機械が読めるようにしておく必要がある (ADR 0007)。
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
  readonly #saveHost: HTMLElement;
  readonly #menuHost: HTMLElement;
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
      // 止めるのは「動いていて、かつ画面が今のコードのまま」のときだけ。
      // 書き換えた後に押すのは、ほぼ必ず再実行のつもりなので実行へ倒す。
      onClick: () => {
        if (this.#running && !this.#stale) this.#options.onStop();
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

    // 保存の置き場 (#87 の段階 4)。**名前のすぐ右** — 何という作品が、どこに
    // 保存されているのかを一度に読ませる。
    this.#saveHost = document.createElement("div");
    this.#saveHost.className = "project-bar-save";

    // 作品メニューの置き場 (#87 の段階 3)。中身を入れるのは WorkMenu で、
    // ここは名前の右という**位置**だけを決める。
    this.#menuHost = document.createElement("div");
    this.#menuHost.className = "project-bar-menu";

    host.replaceChildren(
      this.#button,
      this.#input,
      this.#saveHost,
      this.#menuHost
    );
    this.#renderButton();
  }

  /** 保存の置き場 (名前の右)。 */
  get saveHost(): HTMLElement {
    return this.#saveHost;
  }

  /** 作品メニューの置き場 (保存の右)。 */
  get menuHost(): HTMLElement {
    return this.#menuHost;
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

  /**
   * 画面に出ている実行の世代 (#41 の 6)。
   *
   * ランナーが `rendered` を返した = 往復が通ったときだけ進む。文字で `実行 #n` と
   * 出していた頃と同じ材料を、機械が読める形で残す (E2E の待ち合わせ — ADR 0007)。
   */
  setGeneration(generation: number): void {
    this.#button.dataset.generation = String(generation);
  }

  #renderButton(): void {
    // 停止できるのは「動いていて、画面が今のコードのまま」のときだけ。それ以外は
    // 押すと実行なので ▶ を出す — アイコンと押した結果を食い違わせない。
    const canStop = this.#running && !this.#stale;
    setToolbarButtonIcon(this.#button, canStop ? "stop" : "play");
    setToolbarButtonLabel(
      this.#button,
      canStop
        ? "停止"
        : `${this.#running ? "再実行" : "実行"} (${runShortcutLabel()})`
    );
    // 「実行中で、かつ実行後に編集した」だけ。止まっているときは出さない。
    this.#button.classList.toggle("is-stale", this.#running && this.#stale);
    // 動いているかどうかは、意匠ではなく構造で読めるようにしておく (E2E は
    // ▶/■ の絵ではなくこちらを見る)。
    this.#button.dataset.running = String(this.#running);
  }
}
