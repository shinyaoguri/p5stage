/**
 * 別オリジンのランナーを本体側から操作するクライアント (ADR 0007)。
 *
 * 本体のコードは他者のコードに触れない。ここがやるのは iframe を 1 枚置くことと、
 * postMessage の作法 (origin / source の検証、targetOrigin の明示) を守ることだけ。
 */

import {
  MIN_RUNNER_PROTOCOL_VERSION,
  SKETCH_ALLOW,
  SKETCH_SANDBOX,
  envelope,
  isSupportedRunnerVersion,
  parseRunnerMessage,
  type AssetUrls,
  type ConsoleLevel,
  type HostMessage,
  type SketchFiles,
  type TransitionRequest,
} from "@p5stage/shared";

export interface PreviewHostOptions {
  /** 実行環境のオリジン。本体と別であることは resolveOrigins で検証済みのものを渡す。 */
  readonly previewOrigin: string;
  /** スケッチのコンソール出力。 */
  onConsole?(level: ConsoleLevel, message: string, timestamp: number): void;
  /** 実行した世代が画面に出た。 */
  onRendered?(gen: number): void;
  /** ランナーとつながった。 */
  onReady?(): void;
  /** プロトコルの不一致など、本体側で気付いた異常。 */
  onError?(message: string): void;
}

/** ランナーのパス。 */
const RUNNER_PATH = "/runner/";

/**
 * サムネイルの返事を待つ上限 (Phase 4-4)。
 *
 * サムネイルを知らない古いランナーは `capture` を無視するので、**待ち切りは
 * 通常運転の一部**。実行には何の影響も無いので、待ちは短くてよい。
 */
const CAPTURE_TIMEOUT_MS = 3000;

export class PreviewHost {
  readonly #frame: HTMLIFrameElement;
  readonly #origin: string;
  readonly #options: PreviewHostOptions;
  readonly #abort = new AbortController();

  #ready = false;
  #generation = 0;
  /** ランナーが ready を返す前に来た実行。つながった時点で流す。 */
  #pending: HostMessage | null = null;
  /** 答えを待っているサムネイルの要求 (世代 → 受け取り口)。 */
  readonly #captures = new Map<number, (image: Blob | null) => void>();

  constructor(container: HTMLElement, options: PreviewHostOptions) {
    this.#options = options;
    this.#origin = new URL(options.previewOrigin).origin;

    this.#frame = document.createElement("iframe");
    this.#frame.className = "preview-frame";
    this.#frame.title = "スケッチの実行結果";
    this.#frame.setAttribute("sandbox", SKETCH_SANDBOX);
    this.#frame.setAttribute("allow", SKETCH_ALLOW);
    this.#frame.src = new URL(RUNNER_PATH, this.#origin).href;

    window.addEventListener("message", this.#onMessage, {
      signal: this.#abort.signal,
    });
    container.appendChild(this.#frame);
  }

  /**
   * スケッチを実行する。ランナーが未接続なら、つながった時点で実行する。
   *
   * 切り替えの演出は本体の設定だが、動かすのはダブルバッファを持つランナーなので
   * (ADR 0007)、実行のたびに指示に乗せて渡す。
   *
   * アセットの URL 表も同じく毎回渡す。マニフェストを読んで URL に変えるのは
   * **本体の仕事**で、実行環境は配信オリジンを知らない (ADR 0014)。
   */
  run(
    files: SketchFiles,
    assets: AssetUrls = {},
    transition: TransitionRequest | null = null
  ): void {
    this.#generation += 1;
    this.#send({
      type: "run",
      gen: this.#generation,
      files,
      assets,
      transition,
    });
  }

  /** 実行中のスケッチを止める。 */
  stop(): void {
    this.#generation += 1;
    this.#send({ type: "stop", gen: this.#generation });
  }

  /**
   * 今出ている絵を PNG で受け取る。撮れなければ null (Phase 4-4 / ADR 0019)。
   *
   * 撮るのは実行環境で、本体は画素に触れない。待ち切り・古いランナー・撮影の失敗は
   * すべて null に倒す — **サムネイルは飾りなので、呼び出し側に失敗の分岐を作らせない**。
   *
   * 実行を待たせない (`#pending` に溜めない) のは、つながる前に撮った絵が存在しない
   * ため。溜めても、流れる頃には別の世代になっている。
   */
  capture(timeoutMs: number = CAPTURE_TIMEOUT_MS): Promise<Blob | null> {
    const target = this.#frame.contentWindow;
    if (!this.#ready || target === null) return Promise.resolve(null);

    const gen = this.#generation;
    return new Promise<Blob | null>((resolve) => {
      const timer = setTimeout(() => {
        this.#captures.delete(gen);
        resolve(null);
      }, timeoutMs);

      // 同じ世代で二度頼んだら、後の呼び出しに答えを渡す (前の待ちは null で閉じる)。
      this.#captures.get(gen)?.(null);
      this.#captures.set(gen, (image) => {
        clearTimeout(timer);
        this.#captures.delete(gen);
        resolve(image);
      });

      target.postMessage(
        envelope({ type: "capture", gen } satisfies HostMessage),
        this.#origin
      );
    });
  }

  dispose(): void {
    this.#abort.abort();
    this.#frame.remove();
    // 待っている要求は閉じてから捨てる。放っておくと、消えたランナーの返事を
    // 待つ Promise がタイムアウトまで残る。
    for (const settle of this.#captures.values()) settle(null);
    this.#captures.clear();
  }

  #send(message: HostMessage): void {
    const target = this.#frame.contentWindow;
    if (!this.#ready || target === null) {
      // 最新の指示だけを覚える。溜めても意味が無い (後の実行が前を無効にする)。
      this.#pending = message;
      return;
    }
    target.postMessage(envelope(message), this.#origin);
  }

  readonly #onMessage = (event: MessageEvent): void => {
    if (event.origin !== this.#origin) return;
    if (event.source !== this.#frame.contentWindow) return;

    const message = parseRunnerMessage(event.data);
    if (message === null) return;

    switch (message.type) {
      case "ready": {
        // 断るのは古すぎるランナーだけ。新しい版は受ける — 知らないメッセージは
        // 両側のパーサが捨てるので、追加された機能が効かないだけで実行は通る。
        if (!isSupportedRunnerVersion(message.protocolVersion)) {
          this.#options.onError?.(
            `実行環境のプロトコルが古すぎます (必要 ${MIN_RUNNER_PROTOCOL_VERSION} 以上 / 実行環境 ${message.protocolVersion})`
          );
          return;
        }
        this.#ready = true;
        this.#options.onReady?.();
        const pending = this.#pending;
        this.#pending = null;
        if (pending) this.#send(pending);
        return;
      }
      case "rendered":
        this.#options.onRendered?.(message.gen);
        return;
      case "console":
        this.#options.onConsole?.(
          message.level,
          message.message,
          message.timestamp
        );
        return;
      case "thumbnail":
        // 待っていない世代の答えは捨てる (追い越された実行の絵)。
        this.#captures.get(message.gen)?.(message.image);
        return;
    }
  };
}
