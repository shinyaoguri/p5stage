/**
 * スケッチのコンソールパネル。
 *
 * ランナーから届いた出力の受け口 (ADR 0007)。スケッチの上に重なるので、
 * 面はできるだけ張らず、行が無いときは丸ごと消える。
 *
 * 表示は差分で更新する。全行を組み直すと、draw() の中の log で毎秒 60 回
 * DOM を作り直すことになる。何を足して何を捨てるかの判断は console-log.ts が返し、
 * ここはその 1 件ぶんだけを DOM に反映する。
 */

import type { ConsoleLevel } from "@p5stage/shared";

import "../../styles/console-panel.css";
import { ConsoleLog, type ConsoleEntry } from "./console-log";

/** 下端からこの距離までなら「末尾を見ている」とみなし、新しい行へ追従する。 */
const STICK_THRESHOLD_PX = 8;

export class ConsolePanel {
  readonly #log = new ConsoleLog();
  readonly #container: HTMLElement;
  readonly #countEl: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #lines: HTMLOListElement;
  #collapsed = false;

  constructor(container: HTMLElement) {
    this.#container = container;
    this.#container.classList.add("console-panel");

    this.#toggle = document.createElement("button");
    this.#toggle.type = "button";
    this.#toggle.className = "console-panel-toggle";
    const label = document.createElement("span");
    label.textContent = "コンソール";
    this.#countEl = document.createElement("span");
    this.#countEl.className = "console-panel-count";
    this.#toggle.appendChild(label);
    this.#toggle.appendChild(this.#countEl);
    this.#toggle.addEventListener("click", () => {
      this.#collapsed = !this.#collapsed;
      this.#renderChrome();
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "console-panel-clear";
    clear.textContent = "消去";
    clear.title = "表示中の出力を消す";
    clear.addEventListener("click", () => this.clear());

    const head = document.createElement("div");
    head.className = "console-panel-head";
    head.appendChild(this.#toggle);
    head.appendChild(clear);

    this.#lines = document.createElement("ol");
    this.#lines.className = "console-panel-lines";
    // 実行中の出力を支援技術へ通知する。
    this.#lines.setAttribute("role", "log");
    this.#lines.setAttribute("aria-live", "polite");
    this.#lines.id = "console-panel-lines";
    this.#toggle.setAttribute("aria-controls", this.#lines.id);

    this.#container.replaceChildren(head, this.#lines);
    this.#renderChrome();
  }

  add(level: ConsoleLevel, message: string, timestamp: number): void {
    // 追従の判定は DOM を変える前に採る (足した後では常に「末尾ではない」になる)。
    const stick =
      this.#lines.scrollHeight -
        this.#lines.scrollTop -
        this.#lines.clientHeight <
      STICK_THRESHOLD_PX;

    const update = this.#log.add(level, message, timestamp);
    if (update.kind === "repeated") {
      const last = this.#lines.lastElementChild;
      if (last instanceof HTMLElement) this.#fillLine(last, update.entry);
    } else {
      for (let i = 0; i < update.dropped; i += 1) {
        this.#lines.firstElementChild?.remove();
      }
      this.#lines.appendChild(this.#createLine(update.entry));
    }

    this.#renderChrome();
    if (stick) this.#lines.scrollTop = this.#lines.scrollHeight;
  }

  /** 表示中の出力を消す (実行のたびに呼ぶ)。 */
  clear(): void {
    this.#log.clear();
    this.#lines.replaceChildren();
    this.#renderChrome();
  }

  dispose(): void {
    this.#container.replaceChildren();
  }

  /** 件数と折りたたみ状態。行の増減とは別に、状態が変わるたびに当て直す。 */
  #renderChrome(): void {
    const total = this.#log.total;
    const errors = this.#log.countOf("error");

    this.#container.hidden = total === 0;
    this.#container.classList.toggle("is-collapsed", this.#collapsed);
    this.#lines.hidden = this.#collapsed;

    this.#toggle.setAttribute("aria-expanded", String(!this.#collapsed));
    this.#toggle.title = this.#collapsed
      ? "コンソールを開く"
      : "コンソールを畳む";
    // 畳んでいてもエラーの有無だけは分かるようにする。
    this.#countEl.textContent =
      errors > 0 ? `${total} 件 (エラー ${errors})` : `${total} 件`;
    this.#countEl.classList.toggle("has-error", errors > 0);
  }

  #createLine(entry: ConsoleEntry): HTMLElement {
    const line = document.createElement("li");
    const count = document.createElement("span");
    count.className = "console-line-count";
    const message = document.createElement("span");
    message.className = "console-line-message";
    line.appendChild(count);
    line.appendChild(message);
    this.#fillLine(line, entry);
    return line;
  }

  #fillLine(line: HTMLElement, entry: ConsoleEntry): void {
    line.className = `console-line console-${entry.level}`;
    const count = line.querySelector(".console-line-count");
    const message = line.querySelector(".console-line-message");
    if (count !== null) {
      count.textContent = entry.count > 1 ? `${entry.count}` : "";
    }
    if (message !== null) message.textContent = entry.message;
  }
}
