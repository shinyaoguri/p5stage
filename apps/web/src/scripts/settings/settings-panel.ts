/**
 * エディタ設定のパネル。画面右端から出入りするドロワー (#41 の 4)。
 *
 * 宣言テーブル (definitions.ts) を読んでコントロールを組み立てる。項目を足すのは
 * テーブルへの追記だけで済み、ここには項目ごとの分岐を書かない
 * (移植元 canvastage は 886 行の innerHTML 生成で、項目とマークアップが混ざっていた)。
 *
 * スケッチの上に重なる面なので、開いている間だけ場所を取り、閉じればボタンだけになる。
 * 変更は即時に反映する。ライブコーディング中に「適用」を押させると、調整のたびに
 * 手が止まる。
 *
 * **ドロワーの中身は 3 段** (canvastage と同じ): 見出しと閉じるボタン / 項目 /
 * 「既定に戻す」。スクロールするのは真ん中だけで、閉じる口と戻す口はどれだけ
 * 下まで潜っても同じ場所にある。
 *
 * **項目の群はアコーディオン**。30 項目を一度に広げると、目当ての 1 つを探すのに
 * スクロールが要る。畳んだ見出しの列なら全体が 1 画面に収まり、開くのは触る群だけで済む。
 */

import "../../styles/settings-panel.css";
import {
  SETTING_DEFS,
  SETTING_GROUPS,
  type EditorSettings,
  type SettingDef,
  type SettingGroup,
  type SettingKey,
} from "./definitions";
import { DEFAULT_SETTINGS, withSetting } from "./settings";
import { makeToolbarButton, setToolbarButtonLabel } from "../ui/toolbar-button";

export interface SettingsPanelOptions {
  /** 設定が変わった (即時反映と保存の受け口)。 */
  onChange(settings: EditorSettings): void;
}

/** コントロール 1 つ分。値の書き戻しに使う。 */
interface Control {
  readonly input: HTMLInputElement | HTMLSelectElement;
  /** スライダーに添える現在値の表示。数値以外では null。 */
  readonly output: HTMLElement | null;
}

/**
 * 群の開閉を示す山形 (canvastage の `▾` に相当)。
 *
 * 操作列のアイコン (ui/toolbar-button.ts) には載せない。あちらは「押すと何かが
 * 起きるボタンの絵」の一覧で、これは見出しに添える装飾。回転させるので
 * `currentColor` の線で描く。
 */
const CHEVRON = `<svg class="settings-group-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="6 9 12 15 18 9"/>
</svg>`;

export class SettingsPanel {
  readonly #container: HTMLElement;
  readonly #options: SettingsPanelOptions;
  readonly #body: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #controls = new Map<SettingKey, Control>();
  #settings: EditorSettings;
  #open = false;

  constructor(
    container: HTMLElement,
    settings: EditorSettings,
    options: SettingsPanelOptions
  ) {
    this.#container = container;
    this.#settings = settings;
    this.#options = options;

    this.#toggle = makeToolbarButton({
      icon: "settings",
      label: "エディタの設定を開く",
      onClick: () => this.toggle(),
    });
    this.#toggle.classList.add("settings-panel-toggle");

    this.#body = document.createElement("div");
    this.#body.className = "settings-panel-body";
    this.#body.id = "settings-panel-body";
    this.#body.setAttribute("role", "group");
    this.#body.setAttribute("aria-label", "エディタ設定");
    this.#toggle.setAttribute("aria-controls", this.#body.id);

    // 項目だけがスクロールする面。ヘッダとフッタはその外に置く。
    const content = document.createElement("div");
    content.className = "settings-panel-content";
    for (const [index, group] of SETTING_GROUPS.entries()) {
      content.appendChild(this.#createGroup(group, index));
    }
    this.#body.replaceChildren(
      this.#createHeader(),
      content,
      this.#createFooter()
    );

    // パネルかトグルの上で Escape を押したら閉じる。透過エディタの上に乗る面
    // なので、「消して手元を見たい」がすぐ叶うようにする。
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !this.#open) return;
      event.stopPropagation();
      this.close();
    };
    this.#container.addEventListener("keydown", closeOnEscape);
    this.#body.addEventListener("keydown", closeOnEscape);

    this.#container.replaceChildren(this.#toggle);
    // **ドロワーは画面に対して置く面なので、DOM も画面の直下に置く。**
    // トグルが並ぶ操作列 (edit.astro の `.chrome`) は z-index で重なりの層を
    // 作っており、その中に残すと全高の面がファイルタブや実行ボタンより下に潜る。
    document.body.appendChild(this.#body);
    this.#syncControls();
    this.#renderChrome();
  }

  /** いまの設定。 */
  get settings(): EditorSettings {
    return this.#settings;
  }

  /** 外から設定を差し替える (読み込み直後など)。onChange は呼ばない。 */
  setSettings(settings: EditorSettings): void {
    this.#settings = settings;
    this.#syncControls();
  }

  open(): void {
    this.#open = true;
    this.#renderChrome();
  }

  close(): void {
    // 閉じた面は `inert` にするので、中にフォーカスが残っていると行き場を失う
    // (キーボードだけの人は画面の先頭まで戻される)。開けたボタンへ返す。
    if (this.#body.contains(document.activeElement)) this.#toggle.focus();
    this.#open = false;
    this.#renderChrome();
  }

  toggle(): void {
    if (this.#open) this.close();
    else this.open();
  }

  dispose(): void {
    this.#container.replaceChildren();
    // ドロワーはコンテナの外 (body 直下) にあるので、一緒には消えない。
    this.#body.remove();
    this.#controls.clear();
  }

  #renderChrome(): void {
    this.#body.classList.toggle("is-open", this.#open);
    // `hidden` では消さない。**出入りを見せる面**なので、閉じている間も要素は
    // 残す (CSS が画面の外へ滑らせる)。代わりに `inert` で、見えていない間は
    // フォーカスも読み上げも届かないようにする。
    this.#body.toggleAttribute("inert", !this.#open);
    this.#toggle.setAttribute("aria-expanded", String(this.#open));
    // 開いている間は押されたままに見せる (アイコンなので文字で示せない)。
    this.#toggle.classList.toggle("is-active", this.#open);
    setToolbarButtonLabel(
      this.#toggle,
      this.#open ? "設定を閉じる" : "エディタの設定を開く"
    );
  }

  /**
   * ドロワーの見出し行。
   *
   * 閉じる口をここに置く。トグル (右上の歯車) は開いている間もそのまま閉じる
   * ボタンだが、全高の面に隠れて遠い。**開いた面の中に、その面を閉じる口を置く**。
   */
  #createHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "settings-panel-header";

    const title = document.createElement("h2");
    title.className = "settings-panel-title";
    title.textContent = "設定";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "settings-panel-close";
    // 絵 (×) は読み上げから外し、名前は title と aria-label が持つ
    // (アイコンボタンの作法は ui/toolbar-button.ts と同じ)。
    close.innerHTML = `<span aria-hidden="true">×</span>`;
    close.title = "設定を閉じる";
    close.setAttribute("aria-label", "設定を閉じる");
    close.addEventListener("click", () => this.close());

    header.replaceChildren(title, close);
    return header;
  }

  #createGroup(group: SettingGroup, index: number): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings-group";

    const body = document.createElement("div");
    body.className = "settings-group-body";
    // 見出しから指すための id。群には安定した識別子が無いので並びの番号で振る。
    body.id = `settings-group-${index}`;
    for (const key of group.keys) {
      body.appendChild(this.#createRow(key, SETTING_DEFS[key]));
    }

    // 見出しは見出しのまま押せるようにする (h2 をボタンで置き換えない)。
    // 見出しの一覧で辿る人にとって、群の名前は畳んでいても目次のまま。
    const heading = document.createElement("h2");
    heading.className = "settings-group-title";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "settings-group-toggle";
    toggle.setAttribute("aria-controls", body.id);
    toggle.innerHTML = CHEVRON;
    toggle.prepend(group.title);
    toggle.addEventListener("click", () => {
      this.#setGroupOpen(section, section.classList.contains("is-collapsed"));
    });
    heading.appendChild(toggle);

    section.replaceChildren(heading, body);
    this.#setGroupOpen(section, group.defaultOpen === true);
    return section;
  }

  /** 群 1 つの開閉。見た目 (クラス) と支援技術への知らせ (aria) を一緒に動かす。 */
  #setGroupOpen(section: HTMLElement, open: boolean): void {
    section.classList.toggle("is-collapsed", !open);
    section
      .querySelector(".settings-group-toggle")
      ?.setAttribute("aria-expanded", String(open));
  }

  #createRow(key: SettingKey, def: SettingDef): HTMLElement {
    // ラベルで包むと、コントロールとの関連付けに id が要らない。
    const row = document.createElement("label");
    row.className = `settings-row settings-row-${def.kind}`;
    // 表示名ではなく設定のキーで行を指せるようにする (E2E の足掛かり)。
    row.dataset.settingKey = key;

    const label = document.createElement("span");
    label.className = "settings-row-label";
    label.textContent = def.label;

    const { input, output } = this.#createControl(key, def);
    this.#controls.set(key, { input, output });

    row.appendChild(label);
    if (output !== null) row.appendChild(output);
    row.appendChild(input);
    return row;
  }

  #createControl(key: SettingKey, def: SettingDef): Control {
    if (def.kind === "enum") {
      const select = document.createElement("select");
      for (const option of def.options) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        select.appendChild(element);
      }
      select.addEventListener("change", () => this.#update(key, select.value));
      return { input: select, output: null };
    }

    const input = document.createElement("input");
    switch (def.kind) {
      case "number": {
        input.type = "range";
        input.min = `${def.min}`;
        input.max = `${def.max}`;
        input.step = `${def.step}`;
        const output = document.createElement("output");
        output.className = "settings-row-value";
        input.addEventListener("input", () =>
          this.#update(key, input.valueAsNumber)
        );
        return { input, output };
      }
      case "boolean":
        input.type = "checkbox";
        input.addEventListener("change", () =>
          this.#update(key, input.checked)
        );
        return { input, output: null };
      case "color":
        input.type = "color";
        input.addEventListener("input", () => this.#update(key, input.value));
        return { input, output: null };
      case "text":
        input.type = "text";
        if (def.placeholder !== undefined) input.placeholder = def.placeholder;
        // 入力のたびに反映すると、打っている途中の不完全な値が検証で既定へ
        // 倒され、フォント名が勝手に戻る。確定してから当てる。
        input.addEventListener("change", () => this.#update(key, input.value));
        return { input, output: null };
    }
  }

  #createFooter(): HTMLElement {
    const footer = document.createElement("div");
    footer.className = "settings-panel-footer";

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "settings-panel-reset";
    reset.textContent = "既定に戻す";
    reset.addEventListener("click", () => {
      this.#settings = DEFAULT_SETTINGS;
      this.#syncControls();
      this.#options.onChange(this.#settings);
    });

    footer.appendChild(reset);
    return footer;
  }

  /**
   * 値の変更を 1 件反映する。
   *
   * 入力の値は「その項目が取れる型」であることをコントロールの種類が保証するが、
   * 型の上ではキーごとに違うため、ここで 1 度だけ表明する。実際に使う前に
   * 検証を通す (壊れた値は既定へ倒る) ので、これで設定が壊れることはない。
   */
  #update(key: SettingKey, value: number | boolean | string): void {
    this.#settings = withSetting(
      this.#settings,
      key,
      value as EditorSettings[typeof key]
    );
    this.#syncControl(key);
    this.#options.onChange(this.#settings);
  }

  #syncControls(): void {
    for (const key of this.#controls.keys()) this.#syncControl(key);
  }

  /** コントロールに現在値を書き戻す (既定に戻したときと、値の表示の更新)。 */
  #syncControl(key: SettingKey): void {
    const control = this.#controls.get(key);
    if (control === undefined) return;
    // キーごとのリテラル型ではなく、共通の形として見る (`unit` の有無を問わない)。
    const def: SettingDef = SETTING_DEFS[key];
    const value = this.#settings[key];

    if (control.input instanceof HTMLSelectElement) {
      control.input.value = `${value}`;
      return;
    }
    if (def.kind === "boolean") {
      control.input.checked = value === true;
      return;
    }
    control.input.value = `${value}`;
    if (control.output !== null) {
      control.output.textContent =
        def.kind === "number" && def.unit !== undefined
          ? `${value}${def.unit}`
          : `${value}`;
    }
  }
}
