/**
 * 今開いている作品に対する操作の置き場 (#87 の段階 3)。
 *
 * 右上の操作列に並んでいたもののうち、**この作品に属するもの**をここへ畳む —
 * タグ・アセット・作品ページ・Gist。畳み先を「アカウント」と「作品」に分けたのは、
 * どちらの持ち物かで押す場所が決まる方が覚えやすいため (アカウントメニューに
 * 全部入れると、作品の操作を「自分」の下から探すことになる)。
 *
 * 置き場所は**画面上部中央の、作品の名前の右**。同じ作品を指す 3 つ (実行・名前・
 * この面) が横に並ぶので、視線が名前から離れない。押す口 (保存・全画面・アカウント)
 * が右上に揃っているのに対し、こちらは**今開いている作品**を指す側の集まり。
 *
 * 中身を作るのは各パネル。ここは器と並び順だけを持つ (アカウントメニューと同じ分担)。
 */

import "../../styles/work-menu.css";

import { DropdownMenu, makeMenuSeparator } from "../ui/menu";
import { makeToolbarButton } from "../ui/toolbar-button";

export class WorkMenu {
  readonly #menu: DropdownMenu;

  constructor(host: HTMLElement) {
    const toggle = makeToolbarButton({
      id: "work-menu-toggle",
      icon: "chevronDown",
      // 実際の名前は開閉に合わせて `labelFor` が入れ直す。
      label: "作品メニューを開く",
    });
    toggle.classList.add("work-menu-toggle");

    this.#menu = new DropdownMenu(host, toggle, {
      id: "work-menu",
      // 「作品」ではなく「この作品」。アカウントメニューにある「新しいスケッチ」
      // との違いが、面の名前だけで分かるようにする。
      label: "この作品",
      labelFor: (open) =>
        open ? "作品メニューを閉じる" : "作品メニューを開く",
    });
  }

  /** 項目を足す。並ぶ順は足した順。 */
  addItem(item: HTMLElement): void {
    this.#menu.body.appendChild(item);
  }

  /** 意味の違う群の間に区切りを入れる。 */
  addSeparator(): void {
    this.#menu.body.appendChild(makeMenuSeparator());
  }
}
