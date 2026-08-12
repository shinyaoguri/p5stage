/**
 * 作品を Gist へ保存する側の段取り (Phase 2-3)。
 *
 * GitHub を叩くのはサーバ (ADR 0010)。ここが相手にするのは自分のオリジンの口だけで、
 * 持つのは「今どういう状態か」と「いつ送るか」。
 *
 * 保存の起点は 2 つある。
 *
 * - **明示の保存** (`saveNow`) … 初回はここでしか通らない。まだ Gist が無い作品を
 *   自動保存で勝手に作らない。利用者の GitHub に物を作る操作なので、最初の 1 回は
 *   必ず本人の意思で行う
 * - **自動保存** (`scheduleSave`) … 実行のたびに間引いて PATCH する (要件 3.2)。
 *   打鍵ごとではなく実行ごとにするのは、リビジョンが「動かした形」の履歴になるため
 */

import type { SketchFiles } from "@p5stage/shared";

/** 実行が続いている間、保存を待たせる時間。 */
const AUTO_SAVE_DELAY_MS = 1500;

export type SaveStatus =
  /** 一度も保存していない (Gist がまだ無い)。 */
  | "unsaved"
  /** 保存済みだが、その後に変更がある。 */
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export interface SavedGist {
  readonly id: string;
  readonly url: string;
  readonly revision: string;
}

export interface SaveState {
  readonly status: SaveStatus;
  /** 作品 ID。器を作った時点で決まる。 */
  readonly sketchId: string | null;
  readonly gist: SavedGist | null;
  /** 最後に保存できた時刻。 */
  readonly savedAt: number | null;
  /** 失敗の理由 (status が error のときだけ)。 */
  readonly message: string | null;
}

/** 初回保存で決める値。公開範囲は**ここでしか決められない** (ADR 0010)。 */
export interface SketchMeta {
  readonly title: string;
  readonly visibility: "public" | "unlisted";
}

export interface SketchSaverOptions {
  /** 保存する内容を取りに行く。予約が確定した時点の中身を送るため関数で持つ。 */
  getFiles(): SketchFiles;
  /** 状態が変わった。表示はこれを受けて描く。 */
  onState(state: SaveState): void;
  /** 既に開いている作品の ID (URL の `?sketch=`)。 */
  sketchId?: string | null;
  /** 器ができた。URL に載せ直すために使う。 */
  onCreated?(sketchId: string): void;
}

interface ApiError {
  readonly error?: string;
  readonly message?: string;
}

export class SketchSaver {
  readonly #getFiles: SketchSaverOptions["getFiles"];
  readonly #onState: SketchSaverOptions["onState"];
  readonly #onCreated: SketchSaverOptions["onCreated"];

  #sketchId: string | null;
  #gist: SavedGist | null = null;
  #status: SaveStatus = "unsaved";
  #savedAt: number | null = null;
  #message: string | null = null;
  #dirty = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> | null = null;
  /** 保存中に変更が来た。着地したらもう一度送る。 */
  #again = false;
  /**
   * 「今どの作品を編集しているか」の世代。開き直し・切り離しで進む。
   *
   * 飛んでいる保存の応答が、その間に切り替わった別の作品の状態を上書きしないため。
   */
  #generation = 0;

  constructor(options: SketchSaverOptions) {
    this.#getFiles = options.getFiles;
    this.#onState = options.onState;
    this.#onCreated = options.onCreated;
    this.#sketchId = options.sketchId ?? null;
  }

  get state(): SaveState {
    return {
      status: this.#status,
      sketchId: this.#sketchId,
      gist: this.#gist,
      savedAt: this.#savedAt,
      message: this.#message,
    };
  }

  /** 保存済みの作品を開いたことを伝える (再開時)。 */
  adopt(sketchId: string, gist: SavedGist | null): void {
    this.#generation += 1;
    this.#sketchId = sketchId;
    this.#gist = gist;
    this.#dirty = false;
    this.#emit(gist === null ? "unsaved" : "saved");
  }

  /**
   * 今の作品から切り離す (新規に始めるとき)。
   *
   * 予約中の自動保存も捨てる。これをやらないと、新しく書き始めた内容が**前の作品の
   * Gist へ**書き込まれる。
   */
  detach(): void {
    this.#clearTimer();
    this.#generation += 1;
    this.#sketchId = null;
    this.#gist = null;
    this.#savedAt = null;
    this.#dirty = false;
    this.#again = false;
    this.#emit("unsaved");
  }

  /** 内容が変わった。ここでは送らない (送るのは実行か明示の保存)。 */
  markDirty(): void {
    this.#dirty = true;

    if (this.#status === "saving") {
      this.#again = true;
      return;
    }
    // 失敗の理由は次の保存まで出したままにする。打鍵で消えると、何が起きて
    // 保存できていないのか分からないまま書き続けることになる。
    if (this.#status === "error") return;

    const next = this.#gist === null ? "unsaved" : "dirty";
    if (this.#status !== next) this.#emit(next);
  }

  /**
   * 実行のたびに呼ぶ。Gist ができている作品だけ、間引いて自動保存する。
   *
   * 変更が無ければ何もしない。同じ内容でリビジョンを増やしても履歴が読みにくく
   * なるだけで、GitHub のレート制限を削る意味しか無い。
   */
  scheduleSave(): void {
    if (this.#gist === null || !this.#dirty) return;

    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#save(null);
    }, AUTO_SAVE_DELAY_MS);
  }

  /**
   * 今すぐ保存する。初回は `meta` (タイトルと公開範囲) が要る。
   *
   * 失敗しても投げない。保存できないことは分岐の一つで、編集を止める理由にはならない。
   */
  saveNow(meta: SketchMeta | null = null): Promise<void> {
    this.#clearTimer();
    // 変わっていないなら送らない。同じ内容のリビジョンは履歴を読みにくくする。
    if (!this.#dirty && this.#gist !== null) return Promise.resolve();
    return this.#save(meta);
  }

  /** 予約中の自動保存を捨てる。ページを離れるときなど。 */
  cancelScheduled(): void {
    this.#clearTimer();
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #save(meta: SketchMeta | null): Promise<void> {
    // 走っている保存があれば、その着地を待ってからもう一度送る。同時に 2 本
    // 走らせると、遅い方の古い内容が新しいリビジョンとして残りうる。
    if (this.#inFlight !== null) {
      this.#again = true;
      return this.#inFlight;
    }

    const run = this.#perform(meta).finally(() => {
      this.#inFlight = null;
    });
    this.#inFlight = run;
    await run;

    if (this.#again && this.#dirty && this.#status !== "error") {
      this.#again = false;
      await this.#save(null);
      return;
    }
    this.#again = false;
  }

  async #perform(meta: SketchMeta | null): Promise<void> {
    const generation = this.#generation;
    this.#emit("saving");
    // 送ると決めた時点の中身を採る。往復の間に変わった分は #again で拾う。
    const files = this.#getFiles();
    this.#dirty = false;

    try {
      let sketchId = this.#sketchId;
      if (sketchId === null) {
        sketchId = await this.#createSketch(meta);
        if (sketchId === null) return;
        if (generation !== this.#generation) return;
        this.#sketchId = sketchId;
        this.#onCreated?.(sketchId);
      }

      const response = await fetch(
        `/api/sketches/${encodeURIComponent(sketchId)}/files`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files }),
        }
      );

      // 往復の間に別の作品へ切り替わっていたら、この結果は今の状態ではない。
      if (generation !== this.#generation) return;

      if (!response.ok) {
        this.#fail(await describeFailure(response));
        return;
      }

      const body = (await response.json()) as { gist?: SavedGist };
      this.#gist = body.gist ?? this.#gist;
      this.#savedAt = Date.now();
      this.#message = null;
      this.#emit("saved");
    } catch {
      if (generation !== this.#generation) return;
      this.#fail("保存できませんでした。接続を確認してください");
    }
  }

  /** 器を作る。失敗したら null を返し、状態には理由を残す。 */
  async #createSketch(meta: SketchMeta | null): Promise<string | null> {
    const response = await fetch("/api/sketches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta ?? {}),
    });

    if (!response.ok) {
      this.#fail(await describeFailure(response));
      return null;
    }

    const body = (await response.json()) as { sketch?: { id?: string } };
    const id = body.sketch?.id;
    if (typeof id !== "string") {
      this.#fail("保存できませんでした (応答を解釈できません)");
      return null;
    }
    return id;
  }

  #fail(message: string): void {
    // 送れなかった内容はまだ手元にしか無い。次の保存で送り直せるよう印を戻す。
    this.#dirty = true;
    this.#message = message;
    this.#emit("error");
  }

  #emit(status: SaveStatus): void {
    this.#status = status;
    if (status !== "error") this.#message = null;
    this.#onState(this.state);
  }
}

/** 失敗の応答を、その人が次に何をすればいいか分かる文言にする。 */
async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ApiError;
  if (typeof body.message === "string" && body.message !== "") {
    return body.message;
  }
  if (response.status === 401) {
    return "ログインが切れました。ログインし直してください";
  }
  return `保存できませんでした (${response.status})`;
}
