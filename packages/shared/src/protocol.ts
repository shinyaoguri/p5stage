/**
 * 本体 (host) と実行環境 (runner) の間で交わすメッセージ。
 *
 * ここがクロスオリジンの信頼境界そのもの (ADR 0007)。受信側は
 * `event.origin` / `event.source` を検証したうえで、さらに中身をこのパーサに通す。
 * 送信側は `targetOrigin` を必ず明示する (`"*"` は使わない)。
 */

import { parseSketchFiles, type SketchFiles } from "./files";
import { clampTransitionMs, isTransitionId } from "./transitions";

/**
 * プロトコルのバージョン。
 * ランナーは `ready` に載せて返し、本体は自分の期待と一致するかを確かめる。
 * 本体とランナーは別々にデプロイされるため、片方だけ古い状態が起こりうる。
 */
export const PROTOCOL_VERSION = 1;

/**
 * 交信を識別する印。
 * postMessage は誰でも送れる共有チャネルなので (Vite の HMR なども流れる)、
 * 自分宛てでないメッセージを確実に無視できるようにする。
 */
export const CHANNEL = "p5stage";

/** コンソール出力の種別。 */
export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

const CONSOLE_LEVELS: readonly string[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
];

/**
 * 実行の切り替え演出。ダブルバッファを持つランナー側で適用する (ADR 0007)。
 * どの演出にするかは本体の設定なので、実行の指示に乗せて毎回渡す。
 */
export interface TransitionRequest {
  /** 既知の演出 id (transitions.ts のレジストリにあるもの)。 */
  readonly id: string;
  readonly durationMs: number;
}

/** 本体 → ランナー。 */
export type HostMessage =
  | {
      readonly type: "run";
      readonly gen: number;
      readonly files: SketchFiles;
      /** null なら即時切替。 */
      readonly transition: TransitionRequest | null;
    }
  | { readonly type: "stop"; readonly gen: number };

/** ランナー → 本体。 */
export type RunnerMessage =
  | { readonly type: "ready"; readonly protocolVersion: number }
  | { readonly type: "rendered"; readonly gen: number }
  | {
      readonly type: "console";
      readonly level: ConsoleLevel;
      readonly message: string;
      readonly timestamp: number;
    };

/** postMessage に載せる封筒。中身だけでは自分宛てか判別できない。 */
export interface Envelope<T> {
  readonly channel: typeof CHANNEL;
  readonly message: T;
}

/** メッセージを封筒に入れる。 */
export function envelope<T>(message: T): Envelope<T> {
  return { channel: CHANNEL, message };
}

/** 封筒を開ける。自分宛てでなければ null。 */
function unwrap(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { channel?: unknown; message?: unknown };
  if (candidate.channel !== CHANNEL) return null;
  if (typeof candidate.message !== "object" || candidate.message === null) {
    return null;
  }
  return candidate.message;
}

/** 世代番号・時刻・バージョンはいずれも非負整数。数値らしさをここで一括して確かめる。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * 演出の指定を読み取る。指定が無い・未知の id・壊れた値はすべて「演出なし」に倒す。
 *
 * ここで実行そのものを弾かないのは、演出は見た目の飾りであって、スケッチが動かない
 * 理由にはならないため。長さは範囲外でも丸めて受ける (極端な値でフレームの入れ替えが
 * 止まったままにならないよう、上限は必ず効かせる)。
 */
function parseTransition(value: unknown): TransitionRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, durationMs } = value as { id?: unknown; durationMs?: unknown };
  if (!isTransitionId(id)) return null;
  return {
    id,
    durationMs: clampTransitionMs(
      typeof durationMs === "number" ? durationMs : Number.NaN
    ),
  };
}

/** 受信データを本体 → ランナーのメッセージとして読み取る。妥当でなければ null。 */
export function parseHostMessage(value: unknown): HostMessage | null {
  const message = unwrap(value);
  if (message === null) return null;

  const { type, gen } = message as { type?: unknown; gen?: unknown };
  if (!isNonNegativeInteger(gen)) return null;

  switch (type) {
    case "run": {
      const files = parseSketchFiles((message as { files?: unknown }).files);
      if (files === null) return null;
      const transition = parseTransition(
        (message as { transition?: unknown }).transition
      );
      return { type: "run", gen, files, transition };
    }
    case "stop":
      return { type: "stop", gen };
    default:
      return null;
  }
}

/** 受信データをランナー → 本体のメッセージとして読み取る。妥当でなければ null。 */
export function parseRunnerMessage(value: unknown): RunnerMessage | null {
  const message = unwrap(value);
  if (message === null) return null;

  const record = message as Record<string, unknown>;
  switch (record.type) {
    case "ready":
      return isNonNegativeInteger(record.protocolVersion)
        ? { type: "ready", protocolVersion: record.protocolVersion }
        : null;
    case "rendered":
      return isNonNegativeInteger(record.gen)
        ? { type: "rendered", gen: record.gen }
        : null;
    case "console": {
      const { level, message: text, timestamp } = record;
      if (typeof level !== "string" || !CONSOLE_LEVELS.includes(level)) {
        return null;
      }
      if (typeof text !== "string" || !isNonNegativeInteger(timestamp))
        return null;
      return {
        type: "console",
        level: level as ConsoleLevel,
        message: text,
        timestamp,
      };
    }
    default:
      return null;
  }
}
