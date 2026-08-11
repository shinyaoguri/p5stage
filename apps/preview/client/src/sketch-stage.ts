/**
 * スケッチを表示する 2 枚の iframe (ダブルバッファ)。
 *
 * 実行のたびに文書を作り直すことで、前回のグローバル状態・タイマー・
 * WebGL コンテキストを完全に捨てる。表示中のフレームは差し替え完了まで残すので、
 * 読み込み中に画面が黒く落ちない。
 *
 * ランナーとスケッチは同一オリジン (preview) なので、`srcdoc` も `load` イベントも
 * ここでは素直に使える (ADR 0007)。切り替えの演出もランナーの担当で、
 * 何をどう動かすかの設計図だけを `@p5stage/shared` から受け取る。
 */

import {
  SKETCH_ALLOW,
  SKETCH_SANDBOX,
  TRANSITION_EASING,
  type LayerPlan,
  type LayerStyle,
  type TransitionPlan,
} from "@p5stage/shared";

/** 描画されない状況で requestAnimationFrame を待ち続けないための上限。 */
const PAINT_TIMEOUT_MS = 250;

/** フレームがまだ何も表示していないことを表す世代。 */
const NO_GENERATION = -1;

/** 演出で触るスタイル。遷移の前後で必ずここに挙げた分だけ中立へ戻す。 */
const LAYER_PROPERTIES = [
  "zIndex",
  "opacity",
  "transform",
  "clipPath",
] as const;

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

/** 動きを減らす設定。演出は飾りなので、指定があるなら即時切替に倒す。 */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function applyLayerStyle(frame: HTMLElement, style: LayerStyle): void {
  for (const property of LAYER_PROPERTIES) {
    const value = style[property];
    if (value !== undefined) frame.style[property] = value;
  }
}

/** 演出用のインラインスタイルを消す (visibility は表示制御なので触らない)。 */
function resetLayerStyle(frame: HTMLElement): void {
  for (const property of LAYER_PROPERTIES) frame.style[property] = "";
  frame.style.pointerEvents = "";
}

export interface SketchStageOptions {
  /**
   * その世代のフレームが表示から降りて停止した。
   *
   * 実行ごとに作った資源 (blob URL) を解放してよい合図。文書が生きている間に
   * 解放するとスケッチの実行時読み込みが失敗するので、時点をここで一本化する。
   */
  onRetired(generation: number): void;
}

export interface RunOptions {
  /** 切り替えの演出。null なら即時切替。 */
  readonly transition: TransitionPlan | null;
  readonly durationMs: number;
  /**
   * 新しいフレームが表示に切り替わった。
   * 演出の完了は待たない (待つと、見えているのに「実行中」のままになる)。
   */
  onSwapped?(): void;
}

/** ダブルバッファの添字。2 枚しかないことを型に持たせる。 */
type FrameIndex = 0 | 1;

const FRAME_INDICES = [0, 1] as const;

function otherFrame(index: FrameIndex): FrameIndex {
  return index === 0 ? 1 : 0;
}

export class SketchStage {
  readonly #frames: readonly [HTMLIFrameElement, HTMLIFrameElement];
  readonly #options: SketchStageOptions;
  /** 各フレームが表示している実行の世代。 */
  readonly #frameGenerations: [number, number] = [NO_GENERATION, NO_GENERATION];
  #activeIndex: FrameIndex = 0;
  /** 最後に受け付けた実行の世代。追い越された実行を捨てるのに使う。 */
  #generation = NO_GENERATION;
  /** 進行中の演出。次の実行が来たら打ち切る。 */
  #animations: Animation[] | null = null;

  constructor(container: HTMLElement, options: SketchStageOptions) {
    this.#options = options;
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
   *
   * 演出があるときは、返る時点で既に新しいフレームが表示されている
   * (返り値を待つのは演出が終わって旧フレームを止めるまで)。
   */
  async run(
    html: string,
    generation: number,
    options: RunOptions
  ): Promise<boolean> {
    if (generation < this.#generation) return false;
    this.#generation = generation;

    this.#cancelAnimations();

    const outgoingIndex = this.#activeIndex;
    const incomingIndex = otherFrame(outgoingIndex);
    const outgoing = this.#frames[outgoingIndex];
    const incoming = this.#frames[incomingIndex];

    // 読み込み先のフレームが抱えている実行は、上書きされる時点で役目を終える。
    this.#retire(incomingIndex);

    resetLayerStyle(outgoing);
    resetLayerStyle(incoming);

    const transition = this.#usableTransition(options);
    if (transition !== null) {
      // 初期状態 (重なり順・透明度・位置) を当ててから見せる。順序が逆だと、
      // 遷移が始まる前の 1 フレームだけ新しいスケッチが素で映る。
      applyLayerStyle(outgoing, transition.outgoing.setup);
      applyLayerStyle(incoming, transition.incoming.setup);
      // 演出中は 2 枚が重なる。下に潜ったフレームが入力を横取りしないようにする。
      incoming.style.pointerEvents = "none";
      incoming.style.visibility = "visible";
    }

    await this.#load(incoming, html);
    // 読み込みが終わっても最初の 1 枚を描くまでは中身が無い。ここで待たずに
    // 差し替えると一瞬白く抜ける。
    await nextPaint();

    if (generation !== this.#generation) return false;

    incoming.style.visibility = "visible";
    this.#frameGenerations[incomingIndex] = generation;
    this.#activeIndex = incomingIndex;
    options.onSwapped?.();

    if (transition === null) {
      this.#hide(outgoing);
      this.#retire(outgoingIndex);
      return true;
    }

    await this.#animate(transition, outgoing, incoming, options.durationMs);
    // 追い越されていたら、後から来た実行が既に両フレームを組み替えている。
    if (generation !== this.#generation) return true;

    // 終わった演出を残すと fill: forwards が終端の状態を握り続け、この後の
    // インラインスタイルが効かなくなる。打ち切りと後始末は同じ操作で済む。
    this.#cancelAnimations();
    resetLayerStyle(incoming);
    this.#hide(outgoing);
    this.#retire(outgoingIndex);
    return true;
  }

  /**
   * 実行中のスケッチを止める。
   * 表示は空の文書に変わるだけで、可視・不可視の役割は入れ替えない。
   */
  stop(): void {
    this.#generation += 1;
    this.#cancelAnimations();
    for (const index of FRAME_INDICES) {
      const frame = this.#frames[index];
      resetLayerStyle(frame);
      frame.srcdoc = "";
      this.#retire(index);
    }
  }

  /**
   * 実際に演出を使うか。
   *
   * 初回の実行は剥がす相手 (描画済みの旧フレーム) が無く、黒い面から出てくるだけに
   * なるので演出しない。
   */
  #usableTransition(options: RunOptions): TransitionPlan | null {
    if (options.transition === null) return null;
    if (options.durationMs <= 0) return null;
    if (this.#frameGenerations[this.#activeIndex] === NO_GENERATION)
      return null;
    if (prefersReducedMotion()) return null;
    return options.transition;
  }

  #animate(
    plan: TransitionPlan,
    outgoing: HTMLElement,
    incoming: HTMLElement,
    durationMs: number
  ): Promise<void> {
    const timing: KeyframeAnimationOptions = {
      duration: durationMs,
      easing: TRANSITION_EASING,
      // 終端の状態を保つ。後始末で cancel して外す (次の遷移へ持ち越さない)。
      fill: "forwards",
    };
    const start = (layer: LayerPlan, frame: HTMLElement): Animation | null =>
      layer.keyframes === null
        ? null
        : frame.animate([...layer.keyframes], timing);

    const animations = [
      start(plan.outgoing, outgoing),
      start(plan.incoming, incoming),
    ].filter((animation): animation is Animation => animation !== null);
    this.#animations = animations;

    // cancel されると finished は reject する。打ち切りは異常ではないので飲み込む。
    return Promise.all(animations.map((animation) => animation.finished)).then(
      () => undefined,
      () => undefined
    );
  }

  /** 進行中の演出を打ち切る。cancel は forwards fill の解除も兼ねる。 */
  #cancelAnimations(): void {
    if (this.#animations === null) return;
    for (const animation of this.#animations) animation.cancel();
    this.#animations = null;
  }

  /** フレームを隠して止める (タイマー・音・カメラを確実に手放す)。 */
  #hide(frame: HTMLIFrameElement): void {
    frame.style.visibility = "hidden";
    frame.srcdoc = "";
  }

  /** そのフレームが抱えていた実行の終わりを知らせる。 */
  #retire(index: FrameIndex): void {
    const generation = this.#frameGenerations[index];
    if (generation === NO_GENERATION) return;
    this.#frameGenerations[index] = NO_GENERATION;
    this.#options.onRetired(generation);
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
