/**
 * スケッチを表示する 2 枚の iframe (ダブルバッファ)。
 *
 * 実行のたびに文書を作り直すことで、前回のグローバル状態・タイマー・
 * WebGL コンテキストを完全に捨てる。表示中のフレームは差し替え完了まで残すので、
 * 読み込み中に画面が黒く落ちない。
 *
 * ランナーとスケッチは同一オリジン (preview) なので、`srcdoc` も `load` イベントも
 * ここでは素直に使える (ADR 0007)。
 */

import { SKETCH_ALLOW, SKETCH_SANDBOX } from "@p5stage/shared";

/** 描画されない状況で requestAnimationFrame を待ち続けないための上限。 */
const PAINT_TIMEOUT_MS = 250;

/**
 * 次の描画まで待つ。1 回だと「レイアウトはしたがまだ描いていない」で抜けることがある。
 *
 * 背面タブなど描画が止まっている文書では rAF がそもそも発火しない。そこで待ち続けると
 * 差し替えが永久に起きないので、上限を設けて必ず先へ進む (見えていない以上、
 * ちらつきを避ける理由も無い)。
 */
function nextPaint(): Promise<void> {
  if (document.visibilityState === "hidden") return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, PAINT_TIMEOUT_MS);
  });
}

export class SketchStage {
  readonly #frames: readonly [HTMLIFrameElement, HTMLIFrameElement];
  #activeIndex = 0;
  /** 最後に受け付けた実行の世代。追い越された実行を捨てるのに使う。 */
  #generation = -1;

  constructor(container: HTMLElement) {
    this.#frames = [this.#createFrame(), this.#createFrame()];
    for (const frame of this.#frames) container.appendChild(frame);
    this.#frames[1].style.visibility = "hidden";
  }

  #createFrame(): HTMLIFrameElement {
    const frame = document.createElement("iframe");
    frame.className = "sketch-frame";
    frame.setAttribute("sandbox", SKETCH_SANDBOX);
    frame.setAttribute("allow", SKETCH_ALLOW);
    frame.setAttribute("title", "スケッチの実行結果");
    return frame;
  }

  /** メッセージの送信元がこのステージのフレームか。 */
  isSketchWindow(source: MessageEventSource | null): boolean {
    return this.#frames.some((frame) => frame.contentWindow === source);
  }

  /**
   * HTML を読み込んで表示を差し替える。
   * より新しい実行に追い越された場合は差し替えずに false を返す。
   */
  async run(html: string, generation: number): Promise<boolean> {
    if (generation < this.#generation) return false;
    this.#generation = generation;

    const [first, second] = this.#frames;
    const outgoing = this.#activeIndex === 0 ? first : second;
    const incoming = this.#activeIndex === 0 ? second : first;

    await this.#load(incoming, html);
    // 読み込みが終わっても最初の 1 枚を描くまでは中身が無い。ここで待たずに
    // 差し替えると一瞬白く抜ける。
    await nextPaint();

    if (generation !== this.#generation) return false;

    incoming.style.visibility = "visible";
    outgoing.style.visibility = "hidden";
    this.#activeIndex = this.#activeIndex === 0 ? 1 : 0;

    // 旧フレームは空文書にして止める (タイマー・音・カメラを確実に手放す)。
    outgoing.srcdoc = "";
    return true;
  }

  /** 実行中のスケッチを止める。 */
  stop(): void {
    this.#generation += 1;
    for (const frame of this.#frames) frame.srcdoc = "";
  }

  #load(frame: HTMLIFrameElement, html: string): Promise<void> {
    return new Promise((resolve) => {
      const onLoad = () => {
        frame.removeEventListener("load", onLoad);
        resolve();
      };
      frame.addEventListener("load", onLoad);
      frame.srcdoc = html;
    });
  }
}
