/**
 * ログインの導線とアカウントメニュー (要件 3.6 / #56 / #87 の段階 2)。
 *
 * `gist` scope は**ユーザーの全 Gist への書き込み権限**になる。認可画面へ送り出す前に
 * その意味と、本サービスが何を触るかを必ず見せる義務があるので、ボタンを押すと
 * まず説明が出て、そこから改めて GitHub へ進む形にする (押した瞬間に飛ばさない)。
 *
 * トークンはブラウザに来ない (ADR 0009)。ここが知るのは「誰としてログインしているか」だけ。
 *
 * **メニューはログイン前から開く** (#87)。以前は未ログインだとボタン 1 つ
 * (「GitHub でログイン」) しか無く、そこに何かを畳む余地が無かった。ログインの
 * 有無で操作列のアイコンが増減すると、押す場所も覚え直しになる。**器は常に同じ**に
 * して、中身だけが入れ替わる形にする。
 *
 * メニューには**アカウント以外の項目も入る** (新しいスケッチ・Gist から開く)。
 * どちらも「これから何を書き始めるか」の操作で、今開いている作品には属さない
 * (作品に属するものは中央の作品メニューが持つ)。足すのは持ち主 (edit.astro) の
 * 仕事で、ここは置き場と並び順だけを決める。
 */

import "../../styles/account-panel.css";

import { DropdownMenu, makeMenuItem, makeMenuSeparator } from "../ui/menu";
import { makeToolbarButton, setToolbarButtonIcon } from "../ui/toolbar-button";

/** 認可の結果を伝えるクエリ (`callback.ts` が付ける)。 */
const AUTH_RESULT_PARAM = "auth";

const FAILURE_MESSAGES: Record<string, string> = {
  denied: "GitHub での認可がキャンセルされました",
  invalid_state: "認証の経路が確認できませんでした。もう一度お試しください",
  failed: "GitHub との認証に失敗しました。時間をおいてお試しください",
};

interface Viewer {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string | null;
}

export class AccountPanel {
  readonly #host: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #menu: DropdownMenu;
  readonly #consent: HTMLDialogElement;
  /** 誰としてログインしているか。アイコンでは言えないので文字で持つ。 */
  readonly #who: HTMLParagraphElement;
  readonly #whoSeparator: HTMLElement;
  /** 持ち主が足す項目の置き場 (作品を始める操作)。 */
  readonly #extras: HTMLElement;
  readonly #extrasSeparator: HTMLElement;
  readonly #loginItem: HTMLButtonElement;
  readonly #logoutItem: HTMLButtonElement;
  #viewer: Viewer | null = null;

  constructor(host: HTMLElement) {
    this.#host = host;
    this.#host.classList.add("account-panel");

    // アバターが読めないとき・未ログインのときの姿。ログインすれば画像に替わる。
    this.#toggle = makeToolbarButton({
      id: "account-menu-toggle",
      icon: "person",
      label: "アカウントメニューを開く",
    });
    this.#toggle.classList.add("account-menu-toggle");

    this.#consent = this.#buildConsentDialog();

    this.#who = document.createElement("p");
    this.#who.className = "menu-note";
    this.#who.id = "account-login-name";
    this.#whoSeparator = makeMenuSeparator();

    this.#extras = document.createElement("div");
    this.#extras.className = "menu-group";
    this.#extrasSeparator = makeMenuSeparator();

    this.#loginItem = makeMenuItem({
      id: "login",
      icon: "github",
      label: "GitHub でログイン",
      // 押した瞬間には飛ばさない。何を許すことになるかを先に読ませる (要件 3.6)。
      onClick: () => this.#consent.showModal(),
    });

    this.#logoutItem = makeMenuItem({
      id: "logout",
      icon: "logout",
      label: "ログアウト",
      onClick: () => void this.#logout(),
    });

    this.#menu = new DropdownMenu(this.#host, this.#toggle, {
      id: "account-menu",
      label: "アカウント",
      labelFor: (open) => this.#toggleLabel(open),
    });

    // 並びは「誰か → これから何を書き始めるか → セッション」。上から下へ、
    // 見るだけのものから戻せない操作へ向かう。
    for (const node of [
      this.#who,
      this.#whoSeparator,
      this.#extras,
      this.#extrasSeparator,
      this.#loginItem,
      this.#logoutItem,
    ]) {
      this.#menu.body.appendChild(node);
    }
    // ダイアログは面の外へ置く。メニューを閉じても開いたままでいる必要がある。
    this.#host.appendChild(this.#consent);

    this.#render();
  }

  /**
   * メニューへ項目を足す (アカウントに属さないもの)。
   *
   * 足された項目は**ログイン状態が変わっても消えない**。ログインの有無で入れ替わる
   * のは「誰か」の行とログイン / ログアウトだけで、作品を始める操作はどちらでも要る。
   */
  addItem(item: HTMLElement): void {
    this.#extras.appendChild(item);
    this.#render();
  }

  /** ログイン状態を引き直して描く。 */
  async refresh(): Promise<void> {
    try {
      const response = await fetch("/api/auth/session", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { user: Viewer | null };
      this.#viewer = body.user;
    } catch {
      // 通信できないだけでエディタを止めない。未ログイン扱いで描く。
      this.#viewer = null;
    }
    this.#render();
    /*
     * ログイン状態を引き終えたことを DOM に出す。
     *
     * 器と項目は使い回すようになったので、以前のように押した先が入れ替わって
     * 空振りすることは無い (#51 の原因はそこだった)。それでも「ログインの導線が
     * 出てよい状態か」は外から分からないので、印は残す。
     */
    this.#host.dataset.ready = "true";
  }

  /**
   * URL に残った認可結果を読み、失敗していればその文言を返す。
   *
   * 読んだあとはクエリを消す。リロードのたびに同じ知らせが出るのを防ぐため。
   *
   * 見せ方はこのパネルの仕事ではない。失敗は**もう終わった出来事**で、もう一度
   * ログインすれば済む — 出し先はトースト (#41 の 5)。
   */
  static takeFailureMessage(): string | null {
    const url = new URL(window.location.href);
    const result = url.searchParams.get(AUTH_RESULT_PARAM);
    if (result === null) return null;

    url.searchParams.delete(AUTH_RESULT_PARAM);
    window.history.replaceState(null, "", url.href);

    return FAILURE_MESSAGES[result] ?? null;
  }

  /** 開閉ボタンの名前。誰のメニューかは分かるときだけ添える。 */
  #toggleLabel(open: boolean): string {
    const who = this.#viewer === null ? "" : ` (${this.#viewer.login})`;
    return open
      ? `アカウントメニューを閉じる${who}`
      : `アカウントメニューを開く${who}`;
  }

  #render(): void {
    const viewer = this.#viewer;

    // 絵はログインしていればアバター、していなければ人。
    if (viewer?.avatarUrl != null) {
      const avatar = document.createElement("img");
      avatar.className = "account-avatar";
      avatar.src = viewer.avatarUrl;
      // 名前はボタンの `aria-label` が持つ。画像は装飾として外す。
      avatar.alt = "";
      avatar.width = 20;
      avatar.height = 20;
      // 読めなかったときに空のボタンにならないよう、人のアイコンへ戻す。
      avatar.addEventListener("error", () => {
        setToolbarButtonIcon(this.#toggle, "person");
      });
      this.#toggle.replaceChildren(avatar);
    } else {
      setToolbarButtonIcon(this.#toggle, "person");
    }

    const label = this.#toggleLabel(this.#menu.isOpen);
    this.#toggle.title = label;
    this.#toggle.setAttribute("aria-label", label);

    // アイコンだけでは分からない「誰としてログインしているか」を文字で出す。
    this.#who.textContent = viewer === null ? "" : `@${viewer.login}`;
    this.#who.hidden = viewer === null;
    this.#whoSeparator.hidden = viewer === null;

    this.#loginItem.hidden = viewer !== null;
    this.#logoutItem.hidden = viewer === null;

    // 区切りは**間に何かがあるときだけ**。足された項目が 1 つも無ければ線だけが
    // 残る。
    this.#extras.hidden = this.#extras.childElementCount === 0;
    this.#extrasSeparator.hidden = this.#extras.hidden;
  }

  /**
   * 認可の前に見せる説明。
   *
   * 「何を渡すことになるか」と「こちらが何をするか」を、GitHub の認可画面より先に出す。
   * 認可画面に出るのは scope 名だけで、運用方針までは伝わらないため。
   */
  #buildConsentDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "account-consent";
    dialog.id = "login-consent";

    const title = document.createElement("h2");
    title.textContent = "GitHub の Gist に保存します";

    const scope = document.createElement("p");
    scope.textContent =
      "p5stage は作品をあなた自身の Gist に保存します。そのため GitHub の gist 権限を求めます。これは GitHub の仕様上、あなたの全 Gist を読み書きできる権限になります。";

    const policy = document.createElement("p");
    policy.textContent =
      "p5stage が操作するのは、p5stage で作成した Gist だけです。それ以外の Gist を読み書きすることはありません。";

    const storage = document.createElement("p");
    storage.className = "account-consent-note";
    storage.textContent =
      "アクセストークンはサーバ側で暗号化して保管し、ブラウザには渡しません。ログアウトすればその場で失効します。";

    const actions = document.createElement("div");
    actions.className = "account-consent-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "やめる";
    cancel.addEventListener("click", () => dialog.close());

    // ここだけはリンクにする。トップレベルの遷移で cookie を確実に載せるため。
    const proceed = document.createElement("a");
    proceed.className = "account-consent-proceed";
    proceed.href = "/api/auth/login";
    proceed.textContent = "GitHub へ進む";

    for (const node of [cancel, proceed]) actions.appendChild(node);
    for (const node of [title, scope, policy, storage, actions]) {
      dialog.appendChild(node);
    }
    return dialog;
  }

  async #logout(): Promise<void> {
    try {
      // 同一オリジンへの POST。サーバ側は Origin / Sec-Fetch-Site を見る (ADR 0008)。
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 失敗しても状態を引き直せば実態に追いつく。
    }
    await this.refresh();
  }
}
