/**
 * エディタ設定の宣言 (要件 3.1 の透過エディタを使う人が調整するところ)。
 *
 * **既定値・検証・UI・型をすべてこの 1 つのテーブルから導く。**
 * 移植元 canvastage は zod スキーマ (既定値と範囲) と `SETTING_GROUPS` (ラベルと
 * ウィジェット) に同じ知識が二重に書かれており、片方だけ直すと範囲と UI がずれる。
 * ここでは項目を 1 度だけ書き、`EditorSettings` 型もここから生成する。
 *
 * zod は使っていない。ここで要るのは「壊れた保存値を既定へ倒す」ことだけで、
 * それは宣言テーブルから直接書ける (settings.ts の `sanitizeSettings`)。
 * スキーマを別に持つと、上の二重管理が形を変えて戻ってくる。
 * (Phase 3 の assets.json のような外部データの検証は別問題で、zod の出番はそちら)
 */

import {
  DEFAULT_TRANSITION_ID,
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITION_OPTIONS,
} from "@p5stage/shared";

import { DEFAULT_THEME_NAME, THEME_OPTIONS } from "../editor/themes";

/** 選択肢 1 つ分。 */
export interface SettingOption {
  readonly value: string;
  readonly label: string;
}

/** 数値。UI ではスライダーになる。 */
export interface NumberSettingDef {
  readonly kind: "number";
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** 表示に添える単位 (px など)。値の意味が読み取れないときだけ付ける。 */
  readonly unit?: string;
}

/** 真偽値。UI ではチェックボックスになる。 */
export interface BooleanSettingDef {
  readonly kind: "boolean";
  readonly label: string;
  readonly default: boolean;
}

/** 決まった選択肢。UI では `<select>` になる。 */
export interface EnumSettingDef {
  readonly kind: "enum";
  readonly label: string;
  readonly options: readonly SettingOption[];
  readonly default: string;
}

/** `#rrggbb` の色。UI ではカラーピッカーになる。 */
export interface ColorSettingDef {
  readonly kind: "color";
  readonly label: string;
  readonly default: string;
}

/** 自由入力の文字列。UI ではテキスト欄になる。 */
export interface TextSettingDef {
  readonly kind: "text";
  readonly label: string;
  readonly default: string;
  readonly placeholder?: string;
}

export type SettingDef =
  | NumberSettingDef
  | BooleanSettingDef
  | EnumSettingDef
  | ColorSettingDef
  | TextSettingDef;

/**
 * 既定のフォント。端末にあるものだけで解決する。
 *
 * canvastage は Google Fonts を 21 種類まとめて読み込むが、p5stage では
 * 持ち込まない。第三者ドメインへの読み込みは規約・プライバシー (Phase 6) と
 * 初期表示の重さ (#18) の両方に関わる判断で、設定パネルのついでに決めることではない。
 * フォント名は自由入力にしてあるので、端末に入れてあるフォントは今でも指定できる。
 */
const DEFAULT_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const SETTING_DEFS = {
  editorTheme: {
    kind: "enum",
    label: "配色",
    options: THEME_OPTIONS,
    default: DEFAULT_THEME_NAME,
  },

  fontFamily: {
    kind: "text",
    label: "書体",
    default: DEFAULT_FONT_FAMILY,
    placeholder: "例: 'M PLUS 1 Code', monospace",
  },
  fontSize: {
    kind: "number",
    label: "サイズ",
    min: 10,
    max: 48,
    step: 1,
    default: 14,
    unit: "px",
  },
  fontWeight: {
    kind: "number",
    label: "太さ",
    min: 100,
    max: 900,
    step: 100,
    default: 400,
  },
  lineHeight: {
    kind: "number",
    label: "行の高さ",
    min: 1,
    max: 2,
    step: 0.1,
    default: 1.5,
  },

  textOpacity: {
    kind: "number",
    label: "不透明度",
    min: 0.2,
    max: 1,
    step: 0.05,
    default: 0.9,
  },
  textShadowBlur: {
    kind: "number",
    label: "影のぼかし",
    min: 0,
    max: 10,
    step: 1,
    default: 3,
    unit: "px",
  },
  textShadowColor: {
    kind: "color",
    label: "影の色",
    default: "#000000",
  },
  lineNumberOpacity: {
    kind: "number",
    label: "行番号の不透明度",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },

  cursorColor: { kind: "color", label: "色", default: "#ffffff" },
  cursorOpacity: {
    kind: "number",
    label: "不透明度",
    min: 0.2,
    max: 1,
    step: 0.05,
    default: 0.8,
  },
  cursorWidth: {
    kind: "number",
    label: "太さ",
    min: 1,
    max: 4,
    step: 1,
    default: 2,
    unit: "px",
  },
  cursorStyle: {
    kind: "enum",
    label: "形",
    options: [
      { value: "line", label: "線" },
      { value: "line-thin", label: "細い線" },
      { value: "block", label: "ブロック" },
      { value: "block-outline", label: "ブロック (枠)" },
      { value: "underline", label: "下線" },
      { value: "underline-thin", label: "細い下線" },
    ],
    default: "line",
  },
  cursorBlinking: {
    kind: "enum",
    label: "点滅",
    options: [
      { value: "blink", label: "点滅" },
      { value: "smooth", label: "なめらか" },
      { value: "phase", label: "フェーズ" },
      { value: "expand", label: "拡大" },
      { value: "solid", label: "点滅しない" },
    ],
    default: "blink",
  },

  selectionOpacity: {
    kind: "number",
    label: "選択範囲の濃さ",
    min: 0,
    max: 0.5,
    step: 0.05,
    default: 0.15,
  },
  currentLineColor: { kind: "color", label: "現在行の色", default: "#ffffff" },
  currentLineOpacity: {
    kind: "number",
    label: "現在行の濃さ",
    min: 0,
    max: 0.3,
    step: 0.01,
    default: 0.05,
  },

  suggestBackgroundOpacity: {
    kind: "number",
    label: "背景の濃さ",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
  },
  suggestBlur: {
    kind: "number",
    label: "背景のぼかし",
    min: 0,
    max: 20,
    step: 1,
    default: 8,
    unit: "px",
  },
  suggestTextOpacity: {
    kind: "number",
    label: "文字の不透明度",
    min: 0.2,
    max: 1,
    step: 0.05,
    default: 0.5,
  },

  tabSize: {
    kind: "number",
    label: "タブ幅",
    min: 2,
    max: 8,
    step: 1,
    default: 2,
  },
  wordWrap: {
    kind: "enum",
    label: "折り返し",
    options: [
      { value: "on", label: "する" },
      { value: "off", label: "しない" },
    ],
    default: "on",
  },
  renderWhitespace: {
    kind: "enum",
    label: "空白の表示",
    options: [
      { value: "none", label: "なし" },
      { value: "boundary", label: "境界" },
      { value: "selection", label: "選択範囲" },
      { value: "trailing", label: "行末" },
      { value: "all", label: "すべて" },
    ],
    default: "none",
  },
  indentGuides: {
    kind: "boolean",
    label: "インデントガイド",
    default: false,
  },
  bracketPairGuides: {
    kind: "boolean",
    label: "括弧のガイド",
    default: false,
  },
  bracketMatching: {
    kind: "boolean",
    label: "対応する括弧の強調",
    default: false,
  },
  smoothScrolling: {
    kind: "boolean",
    label: "なめらかなスクロール",
    default: true,
  },
  stickyScroll: {
    kind: "boolean",
    label: "スティッキースクロール",
    default: false,
  },

  transitionId: {
    kind: "enum",
    label: "切り替え",
    options: TRANSITION_OPTIONS,
    default: DEFAULT_TRANSITION_ID,
  },
  transitionMs: {
    kind: "number",
    label: "長さ",
    min: MIN_TRANSITION_MS,
    max: MAX_TRANSITION_MS,
    step: 50,
    default: DEFAULT_TRANSITION_MS,
    unit: "ms",
  },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTING_DEFS;

/** 定義 1 つが持つ値の型。enum は選択肢のリテラル union になる。 */
type ValueOf<D extends SettingDef> = D extends { readonly kind: "number" }
  ? number
  : D extends { readonly kind: "boolean" }
    ? boolean
    : D extends {
          readonly kind: "enum";
          readonly options: readonly { readonly value: infer V }[];
        }
      ? V
      : string;

/**
 * 設定 1 式。
 *
 * 各キーの型は定義から導出する。`wordWrap` が `"on" | "off"` になるので、
 * Monaco のオプションへそのまま渡しても型が通る (文字列に緩めない)。
 */
export type EditorSettings = {
  readonly [K in SettingKey]: ValueOf<(typeof SETTING_DEFS)[K]>;
};

/** 設定パネルの並び。ここに載せないキーは UI に出ない。 */
export interface SettingGroup {
  readonly title: string;
  readonly keys: readonly SettingKey[];
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  { title: "テーマ", keys: ["editorTheme"] },
  {
    title: "フォント",
    keys: ["fontFamily", "fontSize", "fontWeight", "lineHeight"],
  },
  {
    title: "文字",
    keys: [
      "textOpacity",
      "textShadowBlur",
      "textShadowColor",
      "lineNumberOpacity",
    ],
  },
  {
    title: "カーソル",
    keys: [
      "cursorColor",
      "cursorOpacity",
      "cursorWidth",
      "cursorStyle",
      "cursorBlinking",
    ],
  },
  {
    title: "選択と現在行",
    keys: ["selectionOpacity", "currentLineColor", "currentLineOpacity"],
  },
  {
    title: "補完候補",
    keys: ["suggestBackgroundOpacity", "suggestBlur", "suggestTextOpacity"],
  },
  {
    title: "編集",
    keys: [
      "tabSize",
      "wordWrap",
      "renderWhitespace",
      "indentGuides",
      "bracketPairGuides",
      "bracketMatching",
      "smoothScrolling",
      "stickyScroll",
    ],
  },
  { title: "再実行の演出", keys: ["transitionId", "transitionMs"] },
];
