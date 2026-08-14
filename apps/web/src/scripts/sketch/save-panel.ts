/**
 * 保存の導線 (Phase 2-3)。
 *
 * 初回だけ、タイトルと公開範囲を尋ねる。**公開範囲は後から変えられない**ため
 * (GitHub の Gist は作成後に public / secret を変更できない — ADR 0010)、
 * 選ぶ機会をここに置くしかない。限定公開が private ではないことも同じ画面で見せる
 * (要件 3.4)。
 *
 * 保存の状態は文字ではなく**保存アイコンそのもの**が持つ (#41 の 6)。移植元は
 * canvastage の `#share-btn.saved` / `.dirty`。
 *
 * - 保存済みで、その後の変更が無い … 緑
 * - 未保存の変更がある … 橙のドット
 * - 保存できなかった … 赤。**次の保存まで消えない** (段階 5 でトーストに載せ
 *   なかったのはこのため — 打鍵で消えると、保存できていないまま書き続ける)
 */

import "../../styles/dialog.css";
import "../../styles/save-panel.css";

import { sketchPermalink } from "../../lib/sketches/content";
import { formatSavedAt } from "../ui/format-saved-at";
import { makeToolbarButton, makeToolbarLink } from "../ui/toolbar-button";

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

const VISIBILITY_LABELS: Record<SketchMeta["visibility"], string> = {
  unlisted: "限定公開 — URL を知っている人だけが見られます",
  public: "公開 — ギャラリーに載り、誰でも見られます",
};

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
  /** 保存する名前。ダイアログで「何が保存されるか」を見せるために引く。 */
  getTitle(): string;
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
  readonly #dialog: HTMLDialogElement;
  readonly #dialogTitle: HTMLElement;
  readonly #getTitle: SavePanelOptions["getTitle"];
  #state: SaveState | null = null;

  constructor(host: HTMLElement, options: SavePanelOptions) {
    this.#host = host;
    this.#onSave = options.onSave;
    this.#onDetach = options.onDetach;
    this.#getTitle = options.getTitle;
    this.#host.classList.add("save-panel");

    this.#button = makeToolbarButton({
      id: "save",
      icon: "save",
      label: "保存",
      onClick: () => this.#handleClick(),
    });

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
    this.#link = makeToolbarLink({
      id: "gist-link",
      icon: "github",
      label: "Gist を開く",
    });
    this.#link.hidden = true;

    // 人に見せる URL。login を含まない恒久リンクを出す (作者が GitHub で改名しても
    // 生きる。開くと正典 URL へ飛ぶ — ADR 0011)。
    this.#pageLink = makeToolbarLink({
      id: "page-link",
      icon: "externalLink",
      label: "作品ページを開く",
    });
    this.#pageLink.hidden = true;

    // 正本を差し替える口 (Phase 2-6)。GitHub 側で Gist を消してしまった作品を
    // 作り直す道でもあるので、Gist が付いている間はいつでも押せる場所に置く。
    this.#detach = makeToolbarButton({
      id: "detach",
      icon: "unlink",
      label: "Gist を外す",
      onClick: () => {
        if (!window.confirm(DETACH_CONFIRM)) return;
        this.#onDetach();
      },
    });
    this.#detach.hidden = true;

    this.#dialogTitle = document.createElement("strong");
    this.#dialogTitle.id = "save-dialog-title";
    this.#dialog = this.#buildDialog();

    for (const node of [
      this.#status,
      this.#pageLink,
      this.#link,
      this.#detach,
      this.#button,
      this.#dialog,
    ]) {
      this.#host.appendChild(node);
    }
  }

  /** 状態を描き直す。 */
  render(state: SaveState): void {
    this.#state = state;
    // 見た目 (色とドット) は CSS が属性から決める。E2E も意匠ではなくこちらを見る。
    this.#button.dataset.saveStatus = state.status;
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

  #handleClick(): void {
    // 2 回目からはそのまま送る。尋ねる必要があるのは初回だけ。
    if (this.#state !== null && this.#state.sketchId !== null) {
      this.#onSave(null);
      return;
    }
    // 何という名前で保存されるかを、押す前に見せる。名前は上の入力欄にあるが、
    // ダイアログを開くと視線がこちらへ移るので、ここでも一度言う。
    this.#dialogTitle.textContent = this.#getTitle();
    this.#dialog.showModal();
  }

  #buildDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.id = "save-dialog";

    const heading = document.createElement("h2");
    heading.textContent = "あなたの Gist に保存します";

    // 保存される名前。変えたいときは上の入力欄で直せるので、ここでは読ませるだけ。
    const name = document.createElement("p");
    name.className = "save-dialog-name";
    name.textContent = "名前: ";
    name.appendChild(this.#dialogTitle);

    const visibility = this.#buildVisibilityChoice();

    const note = document.createElement("p");
    note.className = "app-note";
    note.textContent =
      "公開範囲は保存後に変更できません (GitHub の Gist は作成後に公開範囲を変えられないため)。変えたいときは別の作品として作り直してください。";

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "やめる";
    cancel.addEventListener("click", () => dialog.close());

    const proceed = document.createElement("button");
    proceed.type = "button";
    proceed.id = "save-confirm";
    proceed.className = "app-dialog-proceed";
    proceed.textContent = "保存";
    proceed.addEventListener("click", () => {
      const selected = visibility.querySelector<HTMLInputElement>(
        "input[name='visibility']:checked"
      );
      dialog.close();
      // 選択が読めないときは限定公開へ倒す。黙って公開になる方向へは倒さない。
      this.#onSave(selected?.value === "public" ? "public" : "unlisted");
    });

    for (const node of [cancel, proceed]) actions.appendChild(node);
    for (const node of [heading, name, visibility, note, actions]) {
      dialog.appendChild(node);
    }
    return dialog;
  }

  #buildVisibilityChoice(): HTMLElement {
    const group = document.createElement("fieldset");
    group.className = "save-visibility";

    const legend = document.createElement("legend");
    legend.textContent = "公開範囲";
    group.appendChild(legend);

    for (const value of ["unlisted", "public"] as const) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "visibility";
      radio.value = value;
      // 既定は限定公開。指定漏れが公開に倒れると、意図しない公開が黙って起きる。
      radio.defaultChecked = value === "unlisted";

      const text = document.createElement("span");
      text.textContent = VISIBILITY_LABELS[value];

      label.appendChild(radio);
      label.appendChild(text);
      group.appendChild(label);
    }

    return group;
  }
}
