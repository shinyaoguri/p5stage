/**
 * ランナー文書のエントリ。
 *
 * 本体 (別オリジン) とは postMessage だけでやり取りし、スケッチの合成・実行・
 * 差し替えはこの文書の中で完結させる (ADR 0007)。本体のコードは他者コードに触れない。
 */

import {
  PROTOCOL_VERSION,
  envelope,
  getTransition,
  parseHostMessage,
  type ConsoleLevel,
  type RunnerMessage,
  type SketchFiles,
  type TransitionRequest,
} from "@p5stage/shared";

import { buildSketchHtml, MissingEntryFileError } from "./build-html";
import { consoleBridgeScript, fileLoaderBridgeScript } from "./bridge-scripts";
import { mimeForFileName } from "./mime";
import { SketchStage } from "./sketch-stage";
import { buildRuntimeUrlMap } from "./virtual-files";

const WEB_ORIGIN_META = "p5stage-web-origin";
/** preview Worker が配信時に実値へ置き換えるプレースホルダ。 */
const WEB_ORIGIN_PLACEHOLDER = "__P5STAGE_WEB_ORIGIN__";

/** 本体オリジンを取り出す。置換されていなければ構成ミスなので動かさない。 */
function readWebOrigin(): string {
  const meta = document.querySelector<HTMLMetaElement>(
    `meta[name="${WEB_ORIGIN_META}"]`
  );
  const value = meta?.content.trim() ?? "";
  if (value === "" || value === WEB_ORIGIN_PLACEHOLDER) {
    throw new Error(
      "本体オリジンが埋め込まれていません (preview Worker を通さずに開いています)"
    );
  }
  return new URL(value).origin;
}

const CONSOLE_LEVELS: readonly ConsoleLevel[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
];

/** スケッチが名乗った種別を既知の値へ丸める (本体のパーサに弾かれないように)。 */
function toConsoleLevel(value: unknown): ConsoleLevel {
  return CONSOLE_LEVELS.includes(value as ConsoleLevel)
    ? (value as ConsoleLevel)
    : "log";
}

/** スケッチのファイルを blob URL として配れるようにする。 */
function createFileUrls(files: SketchFiles): Map<string, string> {
  const urls = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    const blob = new Blob([content], { type: mimeForFileName(name) });
    urls.set(name, URL.createObjectURL(blob));
  }
  return urls;
}

function main(): void {
  // 構成ミスは黙って動かないより、ランナーを直接開いたときに読める形で出す。
  let webOrigin: string;
  try {
    webOrigin = readWebOrigin();
  } catch (error) {
    const notice = document.createElement("p");
    notice.className = "notice";
    notice.textContent = String(error instanceof Error ? error.message : error);
    document.body.appendChild(notice);
    return;
  }

  const toHost = (message: RunnerMessage): void => {
    window.parent.postMessage(envelope(message), webOrigin);
  };

  const report = (level: ConsoleLevel, message: string): void => {
    toHost({ type: "console", level, message, timestamp: Date.now() });
  };

  /**
   * 世代ごとの blob URL。
   *
   * 演出の間は新旧 2 つのスケッチが同時に生きているため、「次の実行が始まったら
   * 前の分を捨てる」ではまだ表示中の文書から資源を取り上げてしまう。解放は
   * ステージが「そのフレームは降りた」と知らせてきた時点に合わせる。
   */
  const fileUrlsByGeneration = new Map<number, Map<string, string>>();

  const releaseFileUrls = (generation: number): void => {
    const urls = fileUrlsByGeneration.get(generation);
    if (urls === undefined) return;
    fileUrlsByGeneration.delete(generation);
    for (const url of urls.values()) URL.revokeObjectURL(url);
  };

  const stage = new SketchStage(document.body, { onRetired: releaseFileUrls });

  const run = async (
    generation: number,
    files: SketchFiles,
    transition: TransitionRequest | null
  ): Promise<void> => {
    const fileUrls = createFileUrls(files);
    let html: string;
    try {
      html = buildSketchHtml(files, {
        headScripts: [
          consoleBridgeScript(window.location.origin),
          fileLoaderBridgeScript(
            buildRuntimeUrlMap(fileUrls, document.baseURI)
          ),
        ],
        resolveFileUrl: (name) => fileUrls.get(name) ?? null,
      });
    } catch (error) {
      for (const url of fileUrls.values()) URL.revokeObjectURL(url);
      report(
        "error",
        error instanceof MissingEntryFileError
          ? error.message
          : `スケッチを組み立てられませんでした: ${String(error)}`
      );
      return;
    }

    fileUrlsByGeneration.set(generation, fileUrls);

    // 差し替えの失敗を握り潰すと、本体からは「実行したのに応答が無い」に見える。
    const swapped = await stage
      .run(html, generation, {
        transition:
          transition === null
            ? null
            : (getTransition(transition.id)?.plan ?? null),
        durationMs: transition?.durationMs ?? 0,
        // 演出の完了ではなく、画面に出た時点で本体へ返す。
        onSwapped: () => toHost({ type: "rendered", gen: generation }),
      })
      .catch((error: unknown) => {
        report("error", `スケッチを差し替えられませんでした: ${String(error)}`);
        return false;
      });

    // 追い越された実行。画面に出ないまま終わるので、ここで捨てる
    // (画面に出た実行の解放は onRetired が受け持つ)。
    if (!swapped) releaseFileUrls(generation);
  };

  window.addEventListener("message", (event: MessageEvent) => {
    // スケッチ (同一オリジンの子フレーム) からの転送。
    if (event.origin === window.location.origin) {
      if (!stage.isSketchWindow(event.source)) return;
      const data = event.data as {
        source?: unknown;
        level?: unknown;
        message?: unknown;
        timestamp?: unknown;
      };
      if (data?.source !== "p5stage-sketch") return;
      toHost({
        type: "console",
        level: toConsoleLevel(data.level),
        message: String(data.message),
        timestamp:
          typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      });
      return;
    }

    // 本体からの指示。オリジンと送信元の両方を確かめる。
    if (event.origin !== webOrigin) return;
    if (event.source !== window.parent) return;

    const message = parseHostMessage(event.data);
    if (message === null) return;

    if (message.type === "run") {
      void run(message.gen, message.files, message.transition);
    } else {
      stage.stop();
    }
  });

  toHost({ type: "ready", protocolVersion: PROTOCOL_VERSION });
}

main();
