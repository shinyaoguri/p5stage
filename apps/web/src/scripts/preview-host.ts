/**
 * 別オリジンのランナーを本体側から操作するクライアント (ADR 0007)。
 *
 * 本体のコードは他者のコードに触れない。ここがやるのは iframe を 1 枚置くことと、
 * postMessage の作法 (origin / source の検証、targetOrigin の明示) を守ることだけ。
 */

import {
  PROTOCOL_VERSION,
  SKETCH_ALLOW,
  SKETCH_SANDBOX,
  envelope,
  parseRunnerMessage,
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

export class PreviewHost {
  readonly #frame: HTMLIFrameElement;
  readonly #origin: string;
  readonly #options: PreviewHostOptions;
  readonly #abort = new AbortController();

  #ready = false;
  #generation = 0;
  /** ランナーが ready を返す前に来た実行。つながった時点で流す。 */
  #pending: HostMessage | null = null;

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
   */
  run(files: SketchFiles, transition: TransitionRequest | null = null): void {
    this.#generation += 1;
    this.#send({ type: "run", gen: this.#generation, files, transition });
  }

  /** 実行中のスケッチを止める。 */
  stop(): void {
    this.#generation += 1;
    this.#send({ type: "stop", gen: this.#generation });
  }

  dispose(): void {
    this.#abort.abort();
    this.#frame.remove();
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
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          this.#options.onError?.(
            `実行環境のプロトコルが一致しません (本体 ${PROTOCOL_VERSION} / 実行環境 ${message.protocolVersion})`
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
    }
  };
}
