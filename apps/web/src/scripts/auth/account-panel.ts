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
  #viewer: Viewer | null = null;
  /** 認可に失敗したときの知らせ。次に描き直すまで残す。 */
  #message: string | null = null;

  constructor(host: HTMLElement) {
    this.#host = host;
    this.#host.classList.add("account-panel");
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

    const button = document.createElement("button");
    button.type = "button";
    button.id = "login";
    button.className = "account-login";
    button.textContent = "GitHub でログイン";

    const dialog = this.#buildConsentDialog();

    button.addEventListener("click", () => dialog.showModal());

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

  #renderSignedIn(): HTMLElement {
    const viewer = this.#viewer;
    const wrapper = document.createElement("div");
    wrapper.className = "account-signed-in";
    if (viewer === null) return wrapper;

    if (viewer.avatarUrl !== null) {
      const avatar = document.createElement("img");
      avatar.className = "account-avatar";
      avatar.src = viewer.avatarUrl;
      avatar.alt = "";
      avatar.width = 20;
      avatar.height = 20;
      wrapper.appendChild(avatar);
    }

    const name = document.createElement("span");
    name.className = "account-login-name";
    name.textContent = viewer.login;

    const logout = document.createElement("button");
    logout.type = "button";
    logout.id = "logout";
    logout.className = "account-logout";
    logout.textContent = "ログアウト";
    logout.addEventListener("click", () => {
      void this.#logout();
    });

    wrapper.appendChild(name);
    wrapper.appendChild(logout);
    return wrapper;
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
