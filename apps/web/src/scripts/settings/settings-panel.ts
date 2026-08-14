/**
 * エディタ設定のパネル。
 *
 * 宣言テーブル (definitions.ts) を読んでコントロールを組み立てる。項目を足すのは
 * テーブルへの追記だけで済み、ここには項目ごとの分岐を書かない
 * (移植元 canvastage は 886 行の innerHTML 生成で、項目とマークアップが混ざっていた)。
 *
 * スケッチの上に重なる面なので、開いている間だけ場所を取り、閉じればボタンだけになる。
 * 変更は即時に反映する。ライブコーディング中に「適用」を押させると、調整のたびに
 * 手が止まる。
 */

import "../../styles/settings-panel.css";
import {
  SETTING_DEFS,
  SETTING_GROUPS,
  type EditorSettings,
  type SettingDef,
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
    this.#container.classList.add("settings-panel");
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

    for (const group of SETTING_GROUPS) {
      this.#body.appendChild(this.#createGroup(group.title, group.keys));
    }
    this.#body.appendChild(this.#createFooter());

    // パネルの中で Escape を押したら閉じる。透過エディタの上に乗る面なので、
    // 「消して手元を見たい」がすぐ叶うようにする。
    this.#container.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.#open) return;
      event.stopPropagation();
      this.close();
      this.#toggle.focus();
    });

    this.#container.replaceChildren(this.#toggle, this.#body);
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
    this.#open = false;
    this.#renderChrome();
  }

  toggle(): void {
    this.#open = !this.#open;
    this.#renderChrome();
  }

  dispose(): void {
    this.#container.replaceChildren();
    this.#controls.clear();
  }

  #renderChrome(): void {
    this.#container.classList.toggle("is-open", this.#open);
    this.#body.hidden = !this.#open;
    this.#toggle.setAttribute("aria-expanded", String(this.#open));
    // 開いている間は押されたままに見せる (アイコンなので文字で示せない)。
    this.#toggle.classList.toggle("is-active", this.#open);
    setToolbarButtonLabel(
      this.#toggle,
      this.#open ? "設定を閉じる" : "エディタの設定を開く"
    );
  }

  #createGroup(title: string, keys: readonly SettingKey[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings-group";

    const heading = document.createElement("h2");
    heading.className = "settings-group-title";
    heading.textContent = title;
    section.appendChild(heading);

    for (const key of keys) {
      section.appendChild(this.#createRow(key, SETTING_DEFS[key]));
    }
    return section;
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
