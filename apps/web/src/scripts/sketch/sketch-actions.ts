/**
 * 作品ページの、ログインしている人にだけ出る操作 (#43 / Phase 4-3)。
 *
 * 作品ページは公開作品をエッジキャッシュに載せている (`s-maxage=60` — ADR 0011)。
 * ログイン状態で HTML を出し分けると**作者向けの姿が他人にも配られ**、`Vary: Cookie`
 * やキャッシュ無効化で逃げると今度はエッジが効かなくなる。どちらも取らず、
 * **HTML は誰に対しても同じままにしてクライアントが足す**。セッションの応答は
 * `private, no-store` なので混ざらない。
 *
 * 見比べるのは login ではなく GitHub の**数値 ID**。login は改名で変わる。
 *
 * ここで決まるのは**見せるかどうか**だけ。編集できるかは
 * `/api/sketches/:id/files` が `owner_id` で守っており (Phase 2-2 / 2-3)、
 * フォークできるかは `/api/sketches/:id/fork` が改めて確かめる。
 */

import "../../styles/sketch-actions.css";

import { editorPath } from "../../lib/sketches/content";
import { ForkDialog } from "./fork-dialog";
import { ForkError, forkSketch } from "./fork-sketch";

/** ログインしている人のうち、ここが要るのは数値 ID だけ。 */
interface Viewer {
  readonly id: number;
}

/** いまログインしている人。引けなければ null (未ログインと同じ姿で描く)。 */
async function currentViewer(): Promise<Viewer | null> {
  try {
    const response = await fetch("/api/auth/session", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as { user: Viewer | null };
    return body.user;
  } catch {
    // 通信できないだけで閲覧を壊さない。操作が出ないだけ。
    return null;
  }
}

export class SketchActions {
  readonly #host: HTMLElement;
  readonly #sketchId: string;
  /** 作者の GitHub 数値 ID。読めなければ null (誰にも作者向けの操作を出さない)。 */
  readonly #ownerId: number | null;
  /** 過去の版を見ているか。 */
  readonly #past: boolean;
  /** 公開作品か。フォークの断り書きに使う。 */
  readonly #isPublic: boolean;
  #forkDialog: ForkDialog | null = null;

  constructor(root: HTMLElement, host: HTMLElement) {
    this.#host = host;
    this.#sketchId = root.dataset.sketchId ?? "";
    this.#past = root.dataset.past === "1";
    this.#isPublic = root.dataset.visibility === "public";

    const ownerId = Number(root.dataset.ownerId);
    this.#ownerId = Number.isSafeInteger(ownerId) ? ownerId : null;
  }

  /** ログイン状態を引いて、その人にできることを足す。 */
  async refresh(): Promise<void> {
    const viewer = await currentViewer();
    if (viewer !== null && this.#sketchId !== "") {
      if (this.#ownerId !== null && viewer.id === this.#ownerId) {
        this.#host.appendChild(this.#editLink());
      } else if (!this.#past) {
        /*
         * 過去の版を見ているときは出さない。
         *
         * fork API は版を選べず、**必ず最新から**分かれる (#44)。`?rev=` を指定して
         * 見ている人にボタンを出すと、押した結果が見ているものと違うことになる。
         */
        this.#host.appendChild(this.#forkButton());
      }
    }
    /*
     * 引き終えたことを DOM に出す (`AccountPanel` と同じ印)。
     *
     * これが無いと「まだ引いていない」と「引いた結果、出ない」を外から区別できない。
     */
    this.#host.dataset.ready = "true";
  }

  /** エディタで開くリンク。 */
  #editLink(): HTMLAnchorElement {
    const link = document.createElement("a");
    link.className = "sketch-action";
    link.id = "sketch-edit-link";
    link.href = editorPath(this.#sketchId);
    link.textContent = "エディタで開く";
    return link;
  }

  /** フォークのボタン。押すと確認が出る (押した瞬間には何も作らない)。 */
  #forkButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sketch-action";
    button.id = "sketch-fork-button";
    button.textContent = "フォーク";
    button.addEventListener("click", () => this.#openForkDialog());
    return button;
  }

  #openForkDialog(): void {
    // 作るのは最初に押されたときだけ。閲覧するだけの人に DOM を積まない。
    this.#forkDialog ??= new ForkDialog(() => this.#fork(), this.#isPublic);
    this.#forkDialog.open();
  }

  /** フォークして、できた作品をエディタで開く。失敗なら文言を返す。 */
  async #fork(): Promise<string | null> {
    try {
      const id = await forkSketch(this.#sketchId);
      /*
       * 行き先は作品ページではなくエディタ。
       *
       * フォークの次にやることは編集で、作品ページへ送ると `publishRevision` が
       * 落ちていたときに「まだ保存されていません」だけが見える (中身は Gist にある)。
       */
      window.location.href = editorPath(id);
      return null;
    } catch (error) {
      if (error instanceof ForkError) return error.message;
      throw error;
    }
  }
}
