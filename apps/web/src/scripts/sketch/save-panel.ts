/**
 * 保存の導線 (Phase 2-3)。
 *
 * **何も尋ねない** (#87 の段階 5)。押せばその場で保存される。エディタは大勢の前へ
 * 投影されながら書かれる場所でもあるので、保存のたびに画面いっぱいの尋ねる面が
 * 出るのは邪魔でしかない。
 *
 * 公開範囲は**設定で 1 度決める** (`settings/definitions.ts` の `defaultVisibility`)。
 * **後から変えられない**値ではあるが (GitHub の Gist は作成後に public / secret を
 * 変更できない — ADR 0010)、だからといって毎回聞く理由にはならない — 決め方は
 * 「作るたびに選ぶ」ではなく「自分の既定を持つ」で足りる。決めた通りに作られたことは
 * 初回の保存でトーストが言う (edit.astro)。
 *
 * 保存の状態は文字ではなく**保存アイコンそのもの**が持つ (#41 の 6)。移植元は
 * canvastage の `#share-btn.saved` / `.dirty`。
 *
 * **絵は GitHub のマーク** (#87 の段階 4)。フロッピーだった頃は「保存した」ことは
 * 分かっても**どこに保存されたのか**が絵から読めず、Gist に載っているかどうかは
 * 「GitHub リンクのアイコンが増えたこと」で示していた (増減は気付きにくい)。
 * 保存先そのものを絵にすれば、色を見るだけで載っているかどうかが分かる。
 *
 * 置き場は**右上の操作列**。段階 4 では中央 (作品の名前の右) へ移したが、そこは
 * 作品そのものの場所で、保存を混ぜると名前の一部のように読めた。**押す口は右上へ
 * 揃える** — どこに保存されるかは絵が言うので、置き場所に頼らなくてよい。
 *
 * 読み方は 2 軸。**色 = Gist に載っているか / ドット = 手元に送っていない変更があるか**。
 *
 * - 灰 … まだ Gist に載っていない
 * - 緑 … 載っている
 * - 橙のドット … 未保存の変更がある (色は載っているかどうかのまま)
 * - 明滅 … 送っている最中
 * - 赤 … 保存できなかった。**次の保存まで消えない** (段階 5 でトーストに載せ
 *   なかったのはこのため — 打鍵で消えると、保存できていないまま書き続ける)
 */

import "../../styles/save-panel.css";

import { sketchPermalink } from "../../lib/sketches/content";
import { formatSavedAt } from "../ui/format-saved-at";
import { makeMenuItem, makeMenuLink } from "../ui/menu";
import { makeToolbarButton } from "../ui/toolbar-button";

import type { SaveState, SketchMeta } from "./sketch-saver";

/**
 * 切り離しの確認文。
 *
 * **削除ではないこと**を最初の行に置く。「外す」も「切り離す」も、消えるのだと
 * 読まれうる語なので、押す前に打ち消しておく必要がある。作品ページから中身が
 * 消えること (ADR 0012) も、知らずに押すと取り返しの付かない驚きになる。
 */
const DETACH_CONFIRM = [
  "この作品と Gist の紐付けを外します (どちらも削除しません)。",
  "",
  "・GitHub の Gist はそのまま残ります",
  "・この作品もエディタの中身もそのまま残ります",
  "・作品ページは「まだ保存されていません」に戻ります",
  "・次に保存すると新しい Gist が作られます",
].join("\n");

function describe(state: SaveState): string {
  switch (state.status) {
    case "unsaved":
      return "未保存";
    case "dirty":
      return "未保存の変更があります";
    case "saving":
      return "保存中…";
    case "saved":
      return state.savedAt === null
        ? "保存済み"
        : `保存しました (${formatSavedAt(state.savedAt)})`;
    case "error":
      return state.message ?? "保存できませんでした";
  }
}

export interface SavePanelOptions {
  /**
   * 保存が押された。初回だけ公開範囲が付く (2 回目以降は null)。
   *
   * タイトルはここで尋ねない。名前は画面上部の入力欄が常時持っている (#41 の 3) ので、
   * 保存のたびに聞き直すと同じことを 2 か所で決めることになる。
   */
  onSave(visibility: SketchMeta["visibility"] | null): void;
  /** 切り離しが確認された (Phase 2-6)。 */
  onDetach(): void;
  /**
   * 初回に作るときの公開範囲 (#87 の段階 5)。
   *
   * 押した時点の設定を引く。設定はドロワーでいつでも変えられるので、作った時の
   * 値を覚え込まない。
   */
  getVisibility(): SketchMeta["visibility"];
}

export class SavePanel {
  readonly #host: HTMLElement;
  readonly #onSave: SavePanelOptions["onSave"];
  readonly #onDetach: SavePanelOptions["onDetach"];
  readonly #button: HTMLButtonElement;
  readonly #status: HTMLElement;
  readonly #link: HTMLAnchorElement;
  readonly #pageLink: HTMLAnchorElement;
  readonly #detach: HTMLButtonElement;
  readonly #getVisibility: SavePanelOptions["getVisibility"];
  #state: SaveState | null = null;

  constructor(host: HTMLElement, options: SavePanelOptions) {
    this.#host = host;
    this.#onSave = options.onSave;
    this.#onDetach = options.onDetach;
    this.#getVisibility = options.getVisibility;
    this.#host.classList.add("save-panel");

    this.#button = makeToolbarButton({
      id: "save",
      icon: "github",
      label: "保存",
      onClick: () => this.#handleClick(),
    });
    this.#button.classList.add("save-btn");

    // 状態は保存アイコンの色とドットが持つが、**色もドットも読み上げられない**。
    // 支援技術へは文字で伝える (画面から消すのは見た目の話で、これごと畳むと
    // 保存できていないことに気付けなくなる)。
    //
    // ボタンの**名前**ではなく**説明**として渡すのがここの要点。名前に混ぜると
    // 「保存」を押すつもりでホバーするたび状態まで読まされ、`保存 (保存しました
    // (8/14 18:03))` のような入れ子になる。読み上げは「保存 ボタン、未保存の
    // 変更があります」と続けて読む。
    this.#status = document.createElement("span");
    this.#status.className = "save-status-sr";
    this.#status.id = "save-status";
    this.#status.setAttribute("role", "status");
    this.#button.setAttribute("aria-describedby", this.#status.id);

    // 保存先を確かめる道。正本が自分の GitHub にあることが目に見えるようにする。
    // 行き先は作品メニュー (#87 の段階 3) — 押す頻度は低く、今の作品に属する。
    this.#link = makeMenuLink({
      id: "gist-link",
      icon: "github",
      label: "Gist を開く",
    });
    this.#link.hidden = true;

    // 人に見せる URL。login を含まない恒久リンクを出す (作者が GitHub で改名しても
    // 生きる。開くと正典 URL へ飛ぶ — ADR 0011)。
    this.#pageLink = makeMenuLink({
      id: "page-link",
      icon: "externalLink",
      label: "作品ページを開く",
    });
    this.#pageLink.hidden = true;

    // 正本を差し替える口 (Phase 2-6)。GitHub 側で Gist を消してしまった作品を
    // 作り直す道でもあるので、Gist が付いている間はいつでも押せる場所に置く。
    this.#detach = makeMenuItem({
      id: "detach",
      icon: "unlink",
      label: "Gist を外す",
      onClick: () => {
        if (!window.confirm(DETACH_CONFIRM)) return;
        this.#onDetach();
      },
    });
    this.#detach.hidden = true;

    // 器に残るのは保存そのものと、その状態を支援技術へ渡す文字だけ。
    // 作品の置き場へ行く 3 つ (作品ページ・Gist・切り離し) は作品メニューへ移した。
    for (const node of [this.#status, this.#button]) {
      this.#host.appendChild(node);
    }
  }

  /**
   * 作品メニューへ差す項目。
   *
   * 出し入れ (`hidden`) は `render()` が今までどおり握る — 押せない操作を
   * 出したままにしない、という線引きは場所が変わっても同じ。
   */
  get menuItems(): HTMLElement[] {
    return [this.#pageLink, this.#link, this.#detach];
  }

  /** 状態を描き直す。 */
  render(state: SaveState): void {
    this.#state = state;
    // 見た目 (色とドット) は CSS が属性から決める。E2E も意匠ではなくこちらを見る。
    this.#button.dataset.saveStatus = state.status;
    // **Gist に載っているかどうかは status とは別の軸** (#87 の段階 4)。保存済みでも
    // 切り離せば載っていない状態になるし、未保存の変更があっても前の版は載っている。
    this.#button.dataset.gist = state.gist === null ? "none" : "present";
    // 名前は「保存」のまま動かさない。状態は `aria-describedby` の先が持つ。
    this.#status.textContent = describe(state);
    this.#button.disabled = state.status === "saving";

    // 作品ページは Gist より先に成立する (器ができた時点で URL が決まる)。
    // 中身がまだ無い状態でも「まだ保存されていません」と出るので、出したままでよい。
    if (state.sketchId === null) {
      this.#pageLink.hidden = true;
    } else {
      this.#pageLink.hidden = false;
      this.#pageLink.href = sketchPermalink(state.sketchId);
    }

    // 切り離せるのは正本が付いている間だけ。付いていなければ操作そのものが無い。
    this.#detach.hidden = state.gist === null;

    if (state.gist === null) {
      this.#link.hidden = true;
      return;
    }
    this.#link.hidden = false;
    this.#link.href = state.gist.url;
  }

  /**
   * 押されたら保存する。**尋ねない** (#87 の段階 5)。
   *
   * 初回だけは器を作る値 (名前と公開範囲) が要る。名前は画面上部の入力欄が、
   * 公開範囲は設定が、それぞれ押す前から持っているので、ここで聞き直すものは何も
   * 残らない。
   */
  #handleClick(): void {
    // 2 回目からは公開範囲も要らない (作った後は変えられない — ADR 0010)。
    if (this.#state !== null && this.#state.sketchId !== null) {
      this.#onSave(null);
      return;
    }
    this.#onSave(this.#getVisibility());
  }
}
