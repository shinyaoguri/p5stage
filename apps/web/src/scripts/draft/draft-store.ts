/**
 * ドラフトの永続化。
 *
 * 保存先は設定と同じ IndexedDB (storage/idb-store.ts) の `drafts` ストア。
 *
 * 設定の保存 (SettingsSaver) との違いは 2 つある。
 *
 * - **最長待ち時間を持つ**。ドラフトを書くきっかけは打鍵で、間引きの期限を
 *   延ばし続けると「書き続けている間は一度も保存されない」になる。手が止まる
 *   のを待たずに、最初の変更から `MAX_SAVE_DELAY_MS` で一度は書く
 * - **書き込みを直列にする**。破棄 (`clear`) と間引き保存が重なると、消した
 *   直後に飛んでいた書き込みが着地してドラフトが甦る。put / delete を 1 本の
 *   鎖につないで、呼んだ順に着地させる
 *
 * 保存できない環境 (IndexedDB が無効・容量超過) でも編集は続けられる。
 * 失敗は投げずに `onError` で伝え、次の変更でまた試みる。
 */

import { createStore, type Store } from "../storage/idb-store";
import { parseDraft, type SketchDraft } from "./draft";

/**
 * ドラフトのキー。
 *
 * Phase 1 は「編集中のスケッチ」が 1 つしか無いので固定。作品を保存できる
 * ようになったら (Phase 2) 作品 ID をキーにして、作品ごとに未保存の変更を
 * 持てるようにする。
 */
const DRAFT_KEY = "current";

/** 打鍵が止まってから書くまで。 */
const SAVE_DELAY_MS = 700;

/** 最初の変更から、遅くともここまでには書く。 */
const MAX_SAVE_DELAY_MS = 3000;

const defaultStore = createStore<unknown>("drafts");

/**
 * 保存済みのドラフトを読む。無いか読めなければ null。
 *
 * 読めない環境でも既定のテンプレートで始められるようにする。ドラフトは
 * あくまで前回の続きで、読めないことがエディタを開けない理由にはならない。
 */
export async function loadDraft(
  store: Store<unknown> = defaultStore
): Promise<SketchDraft | null> {
  try {
    return parseDraft(await store.get(DRAFT_KEY));
  } catch {
    return null;
  }
}

export interface DraftSaverOptions {
  /** 書けた。復元できる状態になったことを人に伝えるために使う。 */
  onSaved?(draft: SketchDraft): void;
  /** 書けなかった。編集は続けられるので、止めるのではなく伝えるだけ。 */
  onError?(): void;
  /** 保存先 (差し替えはテスト用)。 */
  store?: Store<unknown>;
}

interface PendingDraft {
  readonly files: SketchDraft["files"];
  readonly activeFile: string;
  readonly sketchId: string | null;
}

export class DraftSaver {
  readonly #store: Store<unknown>;
  readonly #onSaved: DraftSaverOptions["onSaved"];
  readonly #onError: DraftSaverOptions["onError"];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #maxTimer: ReturnType<typeof setTimeout> | null = null;
  #pending: PendingDraft | null = null;
  /** 書き込みを呼ばれた順に着地させるための鎖。拒否はしない。 */
  #queue: Promise<void> = Promise.resolve();

  constructor(options: DraftSaverOptions = {}) {
    this.#store = options.store ?? defaultStore;
    this.#onSaved = options.onSaved;
    this.#onError = options.onError;
  }

  /** 保存を予約する。連続して呼ばれた分は最後の 1 つにまとまる。 */
  save(
    files: SketchDraft["files"],
    activeFile: string,
    sketchId: string | null = null
  ): void {
    this.#pending = { files, activeFile, sketchId };

    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, SAVE_DELAY_MS);

    // 打鍵が続くかぎり上の期限は延び続ける。書き続けている人ほど保存されない
    // ことになるので、最初の変更から数えた期限を別に持つ。
    this.#maxTimer ??= setTimeout(() => {
      void this.flush();
    }, MAX_SAVE_DELAY_MS);
  }

  /** 予約を待たずに書く。失敗しても投げない (保存できないことは分岐の一つ)。 */
  flush(): Promise<void> {
    this.#clearTimers();
    const pending = this.#pending;
    if (pending === null) return this.#queue;
    this.#pending = null;

    // 時刻は書くと決めた瞬間に採る。予約した時刻を使うと、表示が実際の
    // 書き込みより古くなる。
    const draft: SketchDraft = { ...pending, savedAt: Date.now() };
    return this.#enqueue(async () => {
      try {
        await this.#store.put(DRAFT_KEY, draft);
        this.#onSaved?.(draft);
      } catch {
        this.#onError?.();
      }
    });
  }

  /** 保存済みのドラフトを消す。予約中の保存も捨てる (消した先から書き戻さない)。 */
  clear(): Promise<void> {
    this.#clearTimers();
    this.#pending = null;
    return this.#enqueue(async () => {
      try {
        await this.#store.delete(DRAFT_KEY);
      } catch {
        this.#onError?.();
      }
    });
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    // task は自分で失敗を握るので、鎖が拒否済みになることはない。
    this.#queue = this.#queue.then(task);
    return this.#queue;
  }

  #clearTimers(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#maxTimer !== null) {
      clearTimeout(this.#maxTimer);
      this.#maxTimer = null;
    }
  }
}
