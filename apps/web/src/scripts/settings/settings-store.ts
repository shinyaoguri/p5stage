/**
 * 設定の永続化。
 *
 * 保存先は IndexedDB (storage/idb-store.ts)。ドラフト自動保存 (1-6) と同じ層に
 * 載せてあり、保存先が 2 つに割れないようにしている。
 *
 * スライダーは 1 回の操作で何十回も値が変わるので、書き込みは間引く。
 * 取りこぼしを防ぐため、ページを離れるときは `flush()` で即座に書く。
 */

import { createStore } from "../storage/idb-store";
import type { EditorSettings } from "./definitions";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";

const SETTINGS_KEY = "editor";
const SAVE_DELAY_MS = 300;

const store = createStore<unknown>("settings");

/**
 * 保存済みの設定を読む。
 *
 * 読めない環境 (IndexedDB が無効・容量超過) でも既定で始められるようにする。
 * 設定はあくまで見た目の調整で、読めないことがエディタを開けない理由にはならない。
 */
export async function loadSettings(): Promise<EditorSettings> {
  try {
    return sanitizeSettings(await store.get(SETTINGS_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export class SettingsSaver {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: EditorSettings | null = null;

  /** 保存を予約する。連続して呼ばれた分は最後の 1 つにまとまる。 */
  save(settings: EditorSettings): void {
    this.#pending = settings;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  /** 予約を待たずに書く。失敗しても投げない (保存できないことは分岐の一つ)。 */
  async flush(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const settings = this.#pending;
    if (settings === null) return;
    this.#pending = null;
    try {
      await store.put(SETTINGS_KEY, settings);
    } catch {
      // 保存できない環境でも編集は続けられる。次の変更でまた試みる。
    }
  }
}
