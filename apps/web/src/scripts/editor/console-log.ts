/**
 * スケッチのコンソール出力の溜め込み。
 *
 * ランナーから届く行 (ADR 0007 の console メッセージ) をどう畳んで、どこで捨てるか
 * だけを持つ。DOM は console-panel.ts の担当。
 *
 * 畳むのは見た目の都合ではなく速度の都合でもある。draw() の中の 1 行の log は
 * 毎秒 60 行届くので、そのまま並べると読めないうえに DOM が膨らみ続ける。
 * 直前と同じ行はまとめ、パネル側は末尾 1 件を差し替えるだけで済むようにする。
 */

import type { ConsoleLevel } from "@p5stage/shared";

/** 画面に残す行数の上限。 */
export const MAX_CONSOLE_ENTRIES = 200;

/** まとめた回数の表示上限。これ以上は数え続けても意味が無い。 */
export const MAX_CONSOLE_REPEAT = 9999;

export interface ConsoleEntry {
  readonly level: ConsoleLevel;
  readonly message: string;
  /** 最後にこの行が届いた時刻。 */
  readonly timestamp: number;
  /** 連続して届いた回数。1 なら 1 回だけ。 */
  readonly count: number;
}

/**
 * 1 行を受けた結果。パネルはこれを見て、末尾を書き換えるか 1 件足すかを決める。
 * `dropped` は上限を超えて先頭から捨てた件数。
 */
export type ConsoleUpdate =
  | { readonly kind: "repeated"; readonly entry: ConsoleEntry }
  | {
      readonly kind: "appended";
      readonly entry: ConsoleEntry;
      readonly dropped: number;
    };

export class ConsoleLog {
  #entries: ConsoleEntry[] = [];
  /** 上限で捨てたぶんも含む、届いた行の総数 (レベル別)。 */
  #counts = new Map<ConsoleLevel, number>();

  get entries(): readonly ConsoleEntry[] {
    return this.#entries;
  }

  /** これまでに届いた行の総数 (まとめた回数を数えた実数)。 */
  get total(): number {
    let total = 0;
    for (const count of this.#counts.values()) total += count;
    return total;
  }

  /** 種別ごとの総数。エラーがあることを畳んだ状態でも示せるようにする。 */
  countOf(level: ConsoleLevel): number {
    return this.#counts.get(level) ?? 0;
  }

  add(level: ConsoleLevel, message: string, timestamp: number): ConsoleUpdate {
    this.#counts.set(level, this.countOf(level) + 1);

    const last = this.#entries[this.#entries.length - 1];
    if (
      last !== undefined &&
      last.level === level &&
      last.message === message
    ) {
      const entry: ConsoleEntry = {
        level,
        message,
        timestamp,
        count: Math.min(last.count + 1, MAX_CONSOLE_REPEAT),
      };
      this.#entries[this.#entries.length - 1] = entry;
      return { kind: "repeated", entry };
    }

    const entry: ConsoleEntry = { level, message, timestamp, count: 1 };
    this.#entries.push(entry);
    const dropped = Math.max(0, this.#entries.length - MAX_CONSOLE_ENTRIES);
    if (dropped > 0) this.#entries.splice(0, dropped);
    return { kind: "appended", entry, dropped };
  }

  clear(): void {
    this.#entries = [];
    this.#counts.clear();
  }
}
