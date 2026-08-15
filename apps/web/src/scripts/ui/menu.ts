/**
 * 開閉するだけのドロップダウン (#87 の段階 2)。
 *
 * 操作列に 12 個のアイコンが並んでいた状態から、押す頻度の低いものをここへ畳む。
 * 面が 2 つ (アカウント・作品) になるので、開閉の作法を 1 か所で持つ。
 *
 * **矢印キーで辿る `menu` ではなく、開閉するだけの面として作る** (アカウント
 * メニューが先に選んだ形をそのまま部品にした)。項目は Tab で辿れる普通のボタンで、
 * `role="menu"` を名乗って矢印キーの期待だけ生む、ということをしない。
 *
 * **中はアイコンだけにしない。** 操作列では絵だけで足りていたものも、縦に並ぶと
 * 見分けが付かない。項目は絵と文字を両方持つ (`makeMenuItem`)。
 */

import "../../styles/menu.css";

import { ICONS, type IconName } from "./toolbar-button";

export interface DropdownMenuOptions {
  /** メニュー本体の id (`aria-controls` の行き先)。 */
  readonly id: string;
  /** 面の名前。中身が何の集まりかを支援技術へ渡す。 */
  readonly label: string;
  /**
   * 開閉に合わせた**開閉ボタンの名前**。
   *
   * アイコンは文字を持たないので、開いているかどうかは名前が言うしかない
   * (`aria-expanded` は状態を伝えるが、押すと何が起きるかは伝えない)。
   */
  labelFor?(open: boolean): string;
}

/**
 * 開閉ボタンと、その下に開く面。
 *
 * 器 (`host`) には開閉ボタンと面だけが入る。**面はボタンの直後**に置く —
 * Tab で開いた次に中身へ入れる並びになる。
 */
export class DropdownMenu {
  readonly #host: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #body: HTMLElement;
  readonly #labelFor: ((open: boolean) => string) | null;
  #open = false;

  constructor(
    host: HTMLElement,
    toggle: HTMLButtonElement,
    options: DropdownMenuOptions
  ) {
    this.#host = host;
    this.#toggle = toggle;
    this.#labelFor = options.labelFor ?? null;

    this.#body = document.createElement("div");
    this.#body.className = "menu-panel";
    this.#body.id = options.id;
    this.#body.setAttribute("role", "group");
    this.#body.setAttribute("aria-label", options.label);

    toggle.setAttribute("aria-controls", this.#body.id);
    toggle.addEventListener("click", () => this.toggle());

    this.#host.classList.add("menu-host");
    this.#host.appendChild(toggle);
    this.#host.appendChild(this.#body);

    this.#bindDismissals();
    this.#apply();
  }

  /** 項目を入れる面。中身の差し替えは持ち主の仕事。 */
  get body(): HTMLElement {
    return this.#body;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  toggle(): void {
    this.#open = !this.#open;
    this.#apply();
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#apply();
  }

  /** 閉じて開閉ボタンへ戻る。項目を押した後の後始末。 */
  closeAndFocus(): void {
    const wasOpen = this.#open;
    this.close();
    if (wasOpen) this.#toggle.focus();
  }

  /**
   * 閉じ方は開閉ボタンの押し直し以外に 3 つ。
   *
   * ドロップダウンは「外を触れば消える」面として期待されるし、キーボードだけで
   * 使う人には**触る外側が無い**ので Escape とフォーカス外れの両方が要る。
   * 張るのは**器に対して 1 度だけ**。中身を作り直しても積み上がらない。
   */
  #bindDismissals(): void {
    document.addEventListener("pointerdown", (event) => {
      if (!this.#open) return;
      const target = event.target;
      if (target instanceof Node && this.#host.contains(target)) return;
      this.close();
    });

    // 項目を押したら閉じる。開いた先 (ダイアログ・ドロワー) にメニューが重なった
    // まま残らないようにする。委譲で受けるので、後から足された項目にも効く。
    this.#body.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".menu-item") !== null) {
        this.close();
      }
    });

    this.#host.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.#open) return;
      // 面の中の Escape はここで止める (下のダイアログや Monaco へ渡さない)。
      event.stopPropagation();
      this.closeAndFocus();
    });

    // Tab で外へ出たら閉じる (開いたまま置き去りにしない)。
    this.#host.addEventListener("focusout", (event) => {
      if (!this.#open) return;
      const next = event.relatedTarget;
      if (next instanceof Node && this.#host.contains(next)) return;
      this.close();
    });
  }

  /** 開閉の状態を DOM へ映す。 */
  #apply(): void {
    this.#body.hidden = !this.#open;
    this.#toggle.setAttribute("aria-expanded", String(this.#open));
    // 開いている間は押されたままに見せる (アイコンなので文字で示せない)。
    this.#toggle.classList.toggle("is-active", this.#open);
    if (this.#labelFor !== null) {
      const label = this.#labelFor(this.#open);
      this.#toggle.title = label;
      this.#toggle.setAttribute("aria-label", label);
    }
  }
}

export interface MenuItemOptions {
  readonly label: string;
  readonly icon: IconName;
  readonly id?: string;
  readonly onClick?: () => void;
}

/** メニューの項目 (押すと何かが起きるもの)。 */
export function makeMenuItem(options: MenuItemOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  if (options.id !== undefined) button.id = options.id;
  fillMenuItem(button, options.icon, options.label);
  if (options.onClick !== undefined) {
    button.addEventListener("click", options.onClick);
  }
  return button;
}

export interface MenuLinkOptions {
  readonly label: string;
  readonly icon: IconName;
  readonly id?: string;
}

/**
 * メニューの項目のうち、行き先があるもの。
 *
 * **リンクはリンクのまま**にする — 別のタブで開く・URL をコピーするといった、
 * リンクにしかできない操作が要る (操作列の `makeToolbarLink` と同じ理由)。
 */
export function makeMenuLink(options: MenuLinkOptions): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "menu-item";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (options.id !== undefined) link.id = options.id;
  fillMenuItem(link, options.icon, options.label);
  return link;
}

/** 項目の区切り。意味の違う群の間にだけ入れる。 */
export function makeMenuSeparator(): HTMLElement {
  const separator = document.createElement("div");
  separator.className = "menu-separator";
  // 見た目の区切りでしかないので読み上げには渡さない。
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

/**
 * 項目の中身 (絵 + 文字)。
 *
 * 絵は読み上げから外す。名前は文字の方が持つので、両方読ませると二重になる
 * (操作列のアイコンボタンが `aria-label` を持つのとは事情が逆)。
 */
function fillMenuItem(
  element: HTMLElement,
  icon: IconName,
  label: string
): void {
  const glyph = document.createElement("span");
  glyph.className = "menu-item-icon";
  glyph.innerHTML = ICONS[icon];
  glyph.querySelector("svg")?.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "menu-item-label";
  text.textContent = label;

  element.replaceChildren(glyph, text);
}
