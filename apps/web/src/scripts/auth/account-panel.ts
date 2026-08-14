/**
 * ログインの導線 (要件 3.6)。
 *
 * `gist` scope は**ユーザーの全 Gist への書き込み権限**になる。認可画面へ送り出す前に
 * その意味と、本サービスが何を触るかを必ず見せる義務があるので、ボタンを押すと
 * まず説明が出て、そこから改めて GitHub へ進む形にする (押した瞬間に飛ばさない)。
 *
 * トークンはブラウザに来ない (ADR 0009)。ここが知るのは「誰としてログインしているか」だけ。
 */

import "../../styles/account-panel.css";

import {
  makeToolbarButton,
  setToolbarButtonIcon,
  setToolbarButtonLabel,
} from "../ui/toolbar-button";

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

/** ログイン済みのときに出るアカウントメニューと、その開閉ボタン。 */
interface AccountMenu {
  readonly toggle: HTMLButtonElement;
  readonly body: HTMLElement;
  /** 開閉ボタンの名前に添える login 名 (誰のメニューかを名前で言うため)。 */
  readonly login: string;
}

export class AccountPanel {
  readonly #host: HTMLElement;
  #viewer: Viewer | null = null;
  /** 認可に失敗したときの知らせ。次に描き直すまで残す。 */
  #message: string | null = null;
  /** アカウントメニューを開いているか。 */
  #menuOpen = false;
  /** いま出ているメニュー (未ログインでは null)。描き直すたびに持ち直す。 */
  #menu: AccountMenu | null = null;

  constructor(host: HTMLElement) {
    this.#host = host;
    this.#host.classList.add("account-panel");

    // 閉じ方は**ここで 1 度だけ**張る。`#render()` は中身を作り直すので、
    // 描画のたびに張ると同じ処理が積み上がる。
    this.#bindDismissals();

    this.#render();
  }

  /** 認可の失敗などを利用者に知らせる。null で消す。 */
  setMessage(message: string | null): void {
    this.#message = message;
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
  }

  /**
   * URL に残った認可結果を読み、失敗していればその文言を返す。
   *
   * 読んだあとはクエリを消す。リロードのたびに同じ知らせが出るのを防ぐため。
   */
  static takeFailureMessage(): string | null {
    const url = new URL(window.location.href);
    const result = url.searchParams.get(AUTH_RESULT_PARAM);
    if (result === null) return null;

    url.searchParams.delete(AUTH_RESULT_PARAM);
    window.history.replaceState(null, "", url.href);

    return FAILURE_MESSAGES[result] ?? null;
  }

  #render(): void {
    // 中身ごと作り直すので、開いていたメニューはここで無くなる。状態も閉じた側へ戻す。
    this.#menu = null;
    this.#menuOpen = false;

    this.#host.textContent = "";
    this.#host.appendChild(
      this.#viewer === null ? this.#renderSignedOut() : this.#renderSignedIn()
    );

    if (this.#message === null) return;
    const message = document.createElement("p");
    message.className = "account-message";
    message.id = "auth-message";
    message.setAttribute("role", "status");
    message.textContent = this.#message;
    this.#host.appendChild(message);
  }

  #renderSignedOut(): HTMLElement {
    const wrapper = document.createElement("div");

    const dialog = this.#buildConsentDialog();

    const button = makeToolbarButton({
      id: "login",
      icon: "github",
      label: "GitHub でログイン",
      onClick: () => dialog.showModal(),
    });
    button.classList.add("account-login");

    wrapper.appendChild(button);
    wrapper.appendChild(dialog);
    return wrapper;
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

  /**
   * ログイン済みの姿。
   *
   * **アバター 1 つに畳む** (#41)。login 名を文字で出していたが、操作列は他がすべて
   * アイコンなので、そこだけ可変長の文字が入ると並びが崩れる。
   *
   * **アバターを押すのはメニューを開くだけ**にする (#55)。以前はこのボタン自身が
   * ログアウトを兼ねていたが、アバターは押しても壊れない場所という期待があり、
   * 確認も無くセッションが切れるのは事故になる。ログアウトはメニューの中の項目にし、
   * 誰としてログインしているかもそこで文字として読めるようにする。
   */
  #renderSignedIn(): HTMLElement {
    const viewer = this.#viewer;
    const wrapper = document.createElement("div");
    wrapper.className = "account-signed-in";
    if (viewer === null) return wrapper;

    const toggle = makeToolbarButton({
      id: "account-menu-toggle",
      // アバターが無いときの代わり。下で画像に差し替える。
      icon: "person",
      // 実際の名前は #applyMenuState() が開閉に合わせて入れ直す。
      label: `アカウントメニューを開く (${viewer.login})`,
      onClick: () => this.#toggleMenu(),
    });
    toggle.classList.add("account-menu-toggle");

    if (viewer.avatarUrl !== null) {
      const avatar = document.createElement("img");
      avatar.className = "account-avatar";
      avatar.src = viewer.avatarUrl;
      // 名前はボタンの `aria-label` が持つ。画像は装飾として外す。
      avatar.alt = "";
      avatar.width = 20;
      avatar.height = 20;
      // 読めなかったときに空のボタンにならないよう、人のアイコンへ戻す。
      avatar.addEventListener("error", () => {
        setToolbarButtonIcon(toggle, "person");
      });
      toggle.replaceChildren(avatar);
    }

    const body = this.#buildMenu(viewer);
    toggle.setAttribute("aria-controls", body.id);

    this.#menu = { toggle, body, login: viewer.login };
    this.#applyMenuState();

    // メニューは開閉ボタンの直後に置く。Tab で開いた次に中身へ入れる並びになる。
    for (const node of [toggle, body]) wrapper.appendChild(node);
    return wrapper;
  }

  /**
   * アカウントメニューの中身。
   *
   * 矢印キーで辿る `menu` ではなく、**開閉するだけの面**として作る (設定パネルと同じ)。
   * 項目は Tab で辿れる普通のボタンで、`role="menu"` を名乗って矢印キーの期待だけ
   * 生む、ということをしない。
   */
  #buildMenu(viewer: Viewer): HTMLElement {
    const body = document.createElement("div");
    body.className = "account-menu";
    body.id = "account-menu";
    body.setAttribute("role", "group");
    body.setAttribute("aria-label", "アカウント");

    // アイコンだけでは分からない「誰としてログインしているか」を、ここで文字にする。
    const login = document.createElement("p");
    login.className = "account-menu-login";
    login.textContent = `@${viewer.login}`;

    const logout = document.createElement("button");
    logout.type = "button";
    logout.id = "logout";
    logout.className = "account-menu-item";
    logout.textContent = "ログアウト";
    logout.addEventListener("click", () => {
      void this.#logout();
    });

    for (const node of [login, logout]) body.appendChild(node);
    return body;
  }

  /**
   * メニューの閉じ方。
   *
   * 開閉ボタンの押し直し以外に 2 つ用意する。ドロップダウンは「外を触れば消える」面
   * として期待されるし、キーボードだけで使う人には**触る外側が無い**ので Escape と
   * フォーカス外れの両方が要る。
   */
  #bindDismissals(): void {
    document.addEventListener("pointerdown", (event) => {
      if (!this.#menuOpen) return;
      const target = event.target;
      if (target instanceof Node && this.#host.contains(target)) return;
      this.#closeMenu();
    });

    // パネルの中で Escape を押したら閉じてボタンへ戻る (settings-panel と同じ流儀)。
    this.#host.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.#menuOpen) return;
      event.stopPropagation();
      const toggle = this.#menu?.toggle;
      this.#closeMenu();
      toggle?.focus();
    });

    // Tab でメニューの外へ出たら閉じる (開いたまま置き去りにしない)。
    this.#host.addEventListener("focusout", (event) => {
      if (!this.#menuOpen) return;
      const next = event.relatedTarget;
      if (next instanceof Node && this.#host.contains(next)) return;
      this.#closeMenu();
    });
  }

  #toggleMenu(): void {
    this.#menuOpen = !this.#menuOpen;
    this.#applyMenuState();
  }

  #closeMenu(): void {
    if (!this.#menuOpen) return;
    this.#menuOpen = false;
    this.#applyMenuState();
  }

  /** 開閉の状態を DOM へ映す。 */
  #applyMenuState(): void {
    const menu = this.#menu;
    if (menu === null) return;

    menu.body.hidden = !this.#menuOpen;
    menu.toggle.setAttribute("aria-expanded", String(this.#menuOpen));
    // 開いている間は押されたままに見せる (アイコンなので文字で示せない)。
    menu.toggle.classList.toggle("is-active", this.#menuOpen);
    setToolbarButtonLabel(
      menu.toggle,
      this.#menuOpen
        ? `アカウントメニューを閉じる (${menu.login})`
        : `アカウントメニューを開く (${menu.login})`
    );
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
