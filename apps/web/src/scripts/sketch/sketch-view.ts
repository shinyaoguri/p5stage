/**
 * 作品ページの動く部分 (Phase 2-4 / 4-2)。
 *
 * 最初の中身は SSR が `<pre data-file>` に出しているので、**開いた時点では
 * 取りに行かない**。DOM から集めて実行に回すだけで、同じコードをページに二重に
 * 載せずに済み、JS が動かない環境でもコードは読める。
 *
 * 4-2 で「作者が版を進めたら追従する」が加わった。追従のときだけは中身を取りに行く
 * (`/api/sketches/:id/revisions/:rev`) — ページ全体を読み直すと、閲覧者が見ている
 * 位置も開いているファイルも失われる。
 *
 * エディタ (Monaco) は積まない。閲覧に 943KB を配るのは割に合わない (#18)。
 */

import "../../styles/sketch-view.css";

import {
  assetUrlsForFiles,
  parseSketchFiles,
  type SketchFiles,
} from "@p5stage/shared";

import { initialFileName, orderedFileNames } from "../../lib/sketches/content";
import { PreviewHost } from "../preview-host";

import { LiveClient, revisionUrl, type LiveState } from "./live-client";

/**
 * SSR が出したコード塊。
 *
 * クラスで絞る。`[data-file]` だけだと、タブ (同じ属性を持つ) まで拾ってしまう。
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
  readonly #root: HTMLElement;
  readonly #codeHost: HTMLElement | null;
  readonly #tabHost: HTMLElement | null;
  readonly #assetsOrigin: string | null;
  readonly #tabs = new Map<string, HTMLButtonElement>();

  #blocks: HTMLElement[];
  #active: string | null;
  #host: PreviewHost | null = null;
  #live: LiveClient | null = null;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#blocks = codeBlocks(root);
    this.#active = root.dataset.activeFile ?? null;
    this.#codeHost = root.querySelector<HTMLElement>(".sketch-code");
    this.#tabHost = root.querySelector<HTMLElement>("#sketch-tabs");
    this.#assetsOrigin = root.dataset.assetsOrigin ?? null;

    this.#buildTabs();
    this.#run();
    this.#subscribe();
  }

  /** 購読を畳む。 */
  dispose(): void {
    this.#live?.dispose();
    this.#live = null;
  }

  /** 実行環境につないでスケッチを動かす。 */
  #run(): void {
    const stage = this.#root.querySelector<HTMLElement>("#stage");
    const previewOrigin = this.#root.dataset.previewOrigin;
    if (stage === null || !previewOrigin || this.#blocks.length === 0) return;

    // **ホストは持ち続ける。** 追従のたびに iframe を作り直すと、そのつど
    // ランナーとの握手からやり直しになる (`run` は世代を進めて差し替えるだけ)。
    this.#host = new PreviewHost(stage, { previewOrigin });
    this.#execute(collectFiles(this.#blocks));
  }

  /** 実行に回す。アセットの解決はエディタと同じ道を通る (ADR 0014)。 */
  #execute(files: SketchFiles): void {
    // 作品ページに演出は要らない。開いた時点の姿が出ればよい。
    this.#host?.run(files, assetUrlsForFiles(files, this.#assetsOrigin));
  }

  /**
   * 作者の保存に追従する (Phase 4-2)。
   *
   * 購読するのは**最新の版を、中身が出ている状態で見ているとき**だけ
   * (`data-live` はサーバがその条件で出す)。過去の版を開いている閲覧者を
   * 勝手に最新へ動かさないのが 1 つ、中身が出ていない作品には差し替える先の
   * DOM が無いのがもう 1 つ。
   */
  #subscribe(): void {
    const sketchId = this.#root.dataset.sketchId;
    if (this.#root.dataset.live !== "1" || !sketchId) return;
    if (this.#codeHost === null || this.#host === null) return;

    this.#live = new LiveClient({
      sketchId,
      revision: this.#root.dataset.revision ?? null,
      applyRevision: (revision) => this.#applyRevision(sketchId, revision),
      onState: (state) => this.#showState(state),
    });
  }

  /** その版の中身を取って画面を差し替える。取れなければ投げる (今の表示を残す)。 */
  async #applyRevision(sketchId: string, revision: string): Promise<void> {
    const response = await fetch(revisionUrl(sketchId, revision));
    if (!response.ok)
      throw new Error(`版を取得できません (${response.status})`);

    const body = (await response.json()) as { files?: unknown };
    // 自分たちのサーバからの応答だが、実行に回る値なので形を確かめる。
    const files = parseSketchFiles(body.files);
    if (files === null) throw new Error("版の中身を解釈できません");

    this.#render(files);
    this.#execute(files);
    this.#root.dataset.revision = revision;
  }

  /**
   * コード表示を新しい中身で組み直す。
   *
   * 開いているファイルは**名前で引き継ぐ**。追従のたびに先頭へ戻ると、
   * 作者が別のファイルを直している間、閲覧者は読んでいた場所を毎回見失う。
   */
  #render(files: SketchFiles): void {
    const host = this.#codeHost;
    if (host === null) return;

    const names = orderedFileNames(files);
    this.#active =
      this.#active !== null && names.includes(this.#active)
        ? this.#active
        : initialFileName(files);

    for (const block of this.#blocks) block.remove();
    this.#blocks = names.map((name) => {
      const block = document.createElement("pre");
      block.className = "sketch-file";
      block.dataset.file = name;
      // `textContent` なので中身は解釈されない (他者のコードを埋めても安全)。
      block.textContent = files[name] ?? "";
      host.appendChild(block);
      return block;
    });

    this.#buildTabs();
  }

  /** タブを組み直す。ファイルが 1 つなら選ぶものが無い。 */
  #buildTabs(): void {
    const host = this.#tabHost;
    if (host === null) return;

    for (const tab of this.#tabs.values()) tab.remove();
    this.#tabs.clear();

    if (this.#blocks.length < 2) {
      host.removeAttribute("role");
      this.#applySelection();
      return;
    }

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

  /** 追従しているかを画面に出す。印は CSS が `data-live-state` から描く。 */
  #showState(state: LiveState): void {
    this.#root.dataset.liveState = state;
  }
}
