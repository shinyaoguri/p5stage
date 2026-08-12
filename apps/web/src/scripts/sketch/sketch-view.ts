/**
 * 作品ページの動く部分 (Phase 2-4)。
 *
 * 中身は SSR が `<pre data-file>` に出しているので、**ここでは取りに行かない**。
 * DOM から集めて実行に回すだけ。同じコードをページに二重に載せずに済み、
 * JS が動かない環境でもコードは読める。
 *
 * エディタ (Monaco) は積まない。閲覧に 943KB を配るのは割に合わない (#18)。
 */

import "../../styles/sketch-view.css";

import type { SketchFiles } from "@p5stage/shared";

import { PreviewHost } from "../preview-host";

/**
 * SSR が出したコード塊。
 *
 * クラスで絞る。`[data-file]` だけだと、この後に作るタブ (同じ属性を持つ) まで
 * 拾ってしまう。
 */
function codeBlocks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("pre.sketch-file[data-file]")];
}

/** DOM に出ている中身をファイル構成へ戻す。 */
function collectFiles(blocks: HTMLElement[]): SketchFiles {
  const files: Record<string, string> = {};
  for (const block of blocks) {
    const name = block.dataset.file;
    if (name === undefined) continue;
    files[name] = block.textContent ?? "";
  }
  return files;
}

export class SketchView {
  readonly #blocks: HTMLElement[];
  readonly #tabs = new Map<string, HTMLButtonElement>();
  #active: string | null;

  constructor(root: HTMLElement) {
    this.#blocks = codeBlocks(root);
    this.#active = root.dataset.activeFile ?? null;

    const tabHost = root.querySelector<HTMLElement>("#sketch-tabs");
    if (tabHost !== null) this.#buildTabs(tabHost);

    this.#run(root);
  }

  /** 実行環境につないでスケッチを動かす。 */
  #run(root: HTMLElement): void {
    const stage = root.querySelector<HTMLElement>("#stage");
    const previewOrigin = root.dataset.previewOrigin;
    if (stage === null || !previewOrigin || this.#blocks.length === 0) return;

    // 作品ページに演出は要らない。開いた時点の姿が出ればよい。
    new PreviewHost(stage, { previewOrigin }).run(collectFiles(this.#blocks));
  }

  #buildTabs(host: HTMLElement): void {
    // ファイルが 1 つなら選ぶものが無い。
    if (this.#blocks.length < 2) return;

    host.setAttribute("role", "tablist");
    for (const block of this.#blocks) {
      const name = block.dataset.file;
      if (name === undefined) continue;

      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "sketch-tab";
      tab.dataset.file = name;
      tab.textContent = name;
      tab.setAttribute("role", "tab");
      tab.addEventListener("click", () => this.#select(name));

      this.#tabs.set(name, tab);
      host.appendChild(tab);
    }
    this.#applySelection();
  }

  #select(name: string): void {
    this.#active = name;
    this.#applySelection();
  }

  #applySelection(): void {
    for (const block of this.#blocks) {
      block.hidden = block.dataset.file !== this.#active;
    }
    for (const [name, tab] of this.#tabs) {
      tab.setAttribute("aria-selected", String(name === this.#active));
    }
  }
}
