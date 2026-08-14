/**
 * 直すまで続く条件を示す警告アイコン (#41 の 6)。
 *
 * ここに載るのは**消えると気付けないまま書き続けることになる**条件だけ
 * (読み込めなかった作品・大きすぎて読めなかったファイル・壊れたマニフェスト・
 * 下書きを保存できない環境・実行環境との不一致)。段階 5 でトーストに載せなかった
 * ものの行き先で、性質は変わっていない — **自分では消えない**。
 *
 * 常時テキストを出す代わりにアイコン 1 つへ畳むが、**文面が読めなくなっては
 * 意味が無い**ので 3 通りの道を残す。
 *
 * - 出ていること自体 … 色の付いたアイコン (条件が無い間は影も形も無い)
 * - 文面 … ホバー (`title`) と支援技術 (`aria-label`)
 * - 読み直し … 押すとトーストで再掲する (長い文面はホバーでは読み切れない)
 */

import "../../styles/warning-indicator.css";

import { showToast } from "./toast";
import { makeToolbarButton, setToolbarButtonLabel } from "./toolbar-button";

export class WarningIndicator {
  readonly #button: HTMLButtonElement;
  /**
   * 出ている条件。`id` → 文面。
   *
   * 種類ごとに 1 本持つ。同じ条件を二度足しても増えず、直れば取り下げられる
   * (下書きの保存は容量が空けば通るようになる)。挿入順に並ぶので、先に分かった
   * 条件から読める。
   */
  readonly #messages = new Map<string, string>();

  constructor(host: HTMLElement) {
    this.#button = makeToolbarButton({
      id: "warnings",
      icon: "alert",
      label: "警告",
      // 押しても直りはしない。読み直すための口なので、出ている全部を出し直す。
      onClick: () => {
        for (const message of this.#messages.values()) {
          showToast(message, "error");
        }
      },
    });
    this.#button.classList.add("warning-indicator");
    this.#button.hidden = true;
    host.appendChild(this.#button);
  }

  /**
   * 条件を出す (`message`) / 取り下げる (`null`)。
   *
   * `id` は条件の種類。同じ種類の条件が二本並ばないようにするためのもので、
   * 画面には出ない。
   */
  set(id: string, message: string | null): void {
    if (message === null) this.#messages.delete(id);
    else this.#messages.set(id, message);
    this.#render();
  }

  #render(): void {
    const messages = [...this.#messages.values()];
    this.#button.hidden = messages.length === 0;
    // 件数を先に言う。読む前に「まだ他にもある」ことが分かる。
    const count = messages.length > 1 ? ` (${messages.length} 件)` : "";
    // ホバーと支援技術で同じ文面にする (makeToolbarButton の作法)。区切りは改行 —
    // ツールチップでは行が分かれ、読み上げでは間が空く。
    setToolbarButtonLabel(this.#button, `警告${count}\n${messages.join("\n")}`);
    // 何件出ているかは意匠ではなく構造で読めるようにする (E2E はこちらを見る)。
    this.#button.dataset.count = String(messages.length);
  }
}
