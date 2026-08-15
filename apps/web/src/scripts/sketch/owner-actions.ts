/**
 * 作品ページの、作者にだけ出る操作 (#43)。
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
 * `/api/sketches/:id/files` が `owner_id` で守っている (Phase 2-2 / 2-3) ので、
 * この判定を迂回されても書き込めない。
 */

import "../../styles/sketch-actions.css";

import { editorPath } from "../../lib/sketches/content";

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
    // 通信できないだけで閲覧を壊さない。作者向けの操作が出ないだけ。
    return null;
  }
}

export class OwnerActions {
  readonly #host: HTMLElement;
  readonly #sketchId: string;
  /** 作者の GitHub 数値 ID。読めなければ null (誰にも出さない)。 */
  readonly #ownerId: number | null;

  constructor(root: HTMLElement, host: HTMLElement) {
    this.#host = host;
    this.#sketchId = root.dataset.sketchId ?? "";

    const ownerId = Number(root.dataset.ownerId);
    this.#ownerId = Number.isSafeInteger(ownerId) ? ownerId : null;
  }

  /** ログイン状態を引いて、作者なら操作を足す。 */
  async refresh(): Promise<void> {
    const viewer = await currentViewer();
    if (
      viewer !== null &&
      this.#ownerId !== null &&
      viewer.id === this.#ownerId &&
      this.#sketchId !== ""
    ) {
      this.#host.appendChild(this.#editLink());
    }
    /*
     * 引き終えたことを DOM に出す (`AccountPanel` と同じ印)。
     *
     * 出るか出ないかが分かるまでの間は器が空で、これが無いと「まだ引いていない」と
     * 「引いた結果、出ない」を外から区別できない。
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
}
