/**
 * 透過エディタのテーマ。
 *
 * 実行キャンバスの上に文字だけを浮かせる (要件 3.1) ため、どのテーマでも
 * `editor.background` は完全な透明で固定し、変えるのは構文色だけにする。
 * パレットは移植元 canvastage の配色をそのまま引き継いだもの。
 */

import type { editor } from "monaco-editor";

/** テーマ 1 つ分の構文色。`#` は付けない (Monaco のトークン色は RRGGBB 文字列)。 */
export interface ThemePalette {
  readonly comment: string;
  readonly keyword: string;
  readonly string: string;
  readonly number: string;
  readonly type: string;
  readonly function: string;
  readonly variable: string;
  readonly constant: string;
  /** 未指定なら Monokai 系の既定色。 */
  readonly foreground?: string;
  /** カーソル行の色。CSS 側で上書きするので実質は保険。 */
  readonly lineHighlight?: string;
}

/** 全テーマ共通の色。背景の透明はここで担保する。 */
const TRANSPARENT_COLORS: Readonly<Record<string, string>> = {
  "editor.background": "#00000000",
  "editor.lineHighlightBackground": "#ffffff08",
  "editor.lineHighlightBorder": "#00000000",
  // インデントガイドは既定が薄すぎてスケッチの上では見えない。
  "editorIndentGuide.background1": "#ffffff20",
  "editorIndentGuide.activeBackground1": "#ffffff45",
};

/** 構文色を持たない既定テーマ (vs-dark の色をそのまま透過背景に載せる)。 */
export const DEFAULT_THEME_NAME = "transparent-dark";

/** パレットから Monaco のテーマ定義を作る。 */
export function createThemeData(
  palette: ThemePalette
): editor.IStandaloneThemeData {
  return {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: palette.comment, fontStyle: "italic" },
      { token: "keyword", foreground: palette.keyword },
      { token: "string", foreground: palette.string },
      { token: "number", foreground: palette.number },
      { token: "type", foreground: palette.type, fontStyle: "italic" },
      { token: "function", foreground: palette.function },
      { token: "variable", foreground: palette.variable },
      { token: "constant", foreground: palette.constant },
    ],
    colors: {
      ...TRANSPARENT_COLORS,
      "editor.foreground": `#${palette.foreground ?? "F8F8F2"}`,
      ...(palette.lineHighlight === undefined
        ? {}
        : { "editor.lineHighlightBackground": palette.lineHighlight }),
    },
  };
}

/** 構文色を持たない既定テーマの定義。 */
export const DEFAULT_THEME_DATA: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: { ...TRANSPARENT_COLORS },
};

/** テーマ名 → パレット。設定パネル (1-5) はここを一覧の元にする。 */
export const PALETTES: Readonly<Record<string, ThemePalette>> = {
  monokai: {
    comment: "75715E",
    keyword: "F92672",
    string: "E6DB74",
    number: "AE81FF",
    type: "66D9EF",
    function: "A6E22E",
    variable: "F8F8F2",
    constant: "AE81FF",
  },
  dracula: {
    comment: "6272A4",
    keyword: "FF79C6",
    string: "F1FA8C",
    number: "BD93F9",
    type: "8BE9FD",
    function: "50FA7B",
    variable: "F8F8F2",
    constant: "BD93F9",
  },
  "github-dark": {
    comment: "8B949E",
    keyword: "FF7B72",
    string: "A5D6FF",
    number: "79C0FF",
    type: "FFA657",
    function: "D2A8FF",
    variable: "C9D1D9",
    constant: "79C0FF",
    foreground: "C9D1D9",
  },
  nord: {
    comment: "616E88",
    keyword: "81A1C1",
    string: "A3BE8C",
    number: "B48EAD",
    type: "8FBCBB",
    function: "88C0D0",
    variable: "D8DEE9",
    constant: "B48EAD",
    foreground: "D8DEE9",
  },
  solarized: {
    comment: "586E75",
    keyword: "859900",
    string: "2AA198",
    number: "D33682",
    type: "B58900",
    function: "268BD2",
    variable: "839496",
    constant: "CB4B16",
    foreground: "839496",
  },
  "one-dark": {
    comment: "5C6370",
    keyword: "C678DD",
    string: "98C379",
    number: "D19A66",
    type: "E5C07B",
    function: "61AFEF",
    variable: "E06C75",
    constant: "D19A66",
    foreground: "ABB2BF",
  },
  cyberpunk: {
    comment: "6A6A8E",
    keyword: "FF2A6D",
    string: "05D9E8",
    number: "D1F7FF",
    type: "FF6AC1",
    function: "01FFC3",
    variable: "FCEE0A",
    constant: "FF9F1C",
    foreground: "D1F7FF",
    lineHighlight: "#ff2a6d10",
  },
};

/**
 * 設定パネルに出す選択肢 (既定テーマを先頭に置く)。
 *
 * ラベルは配色の通称なので訳さない。既定テーマだけは通称を持たないため、
 * 何が起きるか (vs-dark の色をそのまま透過背景に載せる) が分かる名前にする。
 */
export const THEME_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: DEFAULT_THEME_NAME, label: "既定 (ダーク)" },
  { value: "monokai", label: "Monokai" },
  { value: "dracula", label: "Dracula" },
  { value: "github-dark", label: "GitHub Dark" },
  { value: "nord", label: "Nord" },
  { value: "solarized", label: "Solarized" },
  { value: "one-dark", label: "One Dark" },
  { value: "cyberpunk", label: "Cyberpunk" },
];

/** 選べるテーマ名の一覧 (既定テーマを先頭に置く)。 */
export const THEME_NAMES: readonly string[] = [
  DEFAULT_THEME_NAME,
  ...Object.keys(PALETTES),
];
