/**
 * 下書きが今どうなっているかを示すドット (#41 の 6)。
 *
 * `下書きを保存 (8/12 14:30)` の文字を畳んだもの。**書けていること**は編集中ずっと
 * 成り立っている状態なので、文字で出すと読み流される割に場所を取り続ける。
 *
 * 押す口は無い (下書きに対してできる操作が無い)。ボタンではなくただの印なので
 * `<span>` で置き、時刻はホバー (`title`) と支援技術 (`aria-label`) で読ませる。
 *
 * **書けない**ことの方は消えると困るので、ここではなく警告アイコンが持つ
 * (scripts/ui/warning-indicator.ts)。
 */

import "../../styles/draft-indicator.css";

import { formatSavedAt } from "../ui/format-saved-at";

export class DraftIndicator {
  readonly #element: HTMLElement;

  constructor(host: HTMLElement) {
    this.#element = document.createElement("span");
    this.#element.id = "draft-status";
    this.#element.className = "draft-indicator";
    // 出入りがあるので `status` で読ませる。何も無いうちは要素ごと隠れている。
    this.#element.setAttribute("role", "status");
    this.#element.hidden = true;
    host.appendChild(this.#element);
  }

  /** 下書きを書けた時刻。`null` で「まだ何も書いていない」(印ごと消える)。 */
  setSavedAt(savedAt: number | null): void {
    if (savedAt === null) {
      this.#element.hidden = true;
      delete this.#element.dataset.savedAt;
      this.#element.removeAttribute("title");
      this.#element.removeAttribute("aria-label");
      return;
    }
    const label = `下書きを保存 (${formatSavedAt(savedAt)})`;
    this.#element.hidden = false;
    // 時刻そのものは意匠を経由せずに読めるようにしておく (E2E はこちらを見る)。
    this.#element.dataset.savedAt = String(savedAt);
    this.#element.title = label;
    this.#element.setAttribute("aria-label", label);
  }
}
