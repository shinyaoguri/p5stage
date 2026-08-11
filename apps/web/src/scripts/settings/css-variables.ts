/**
 * 設定 → 透過エディタの CSS 変数。
 *
 * 変数の定義は styles/editor-overlay.css の `:root` にあり、ここはその値を
 * 差し替える。Monaco が自前で持つ見た目 (フォント・折り返しなど) は
 * editor-options.ts が担当し、こちらは **CSS でしか触れない層** だけを持つ。
 *
 * 不透明度を含む色は JS 側で完全な色文字列に組み立てる。CSS のミニファイアは
 * `rgba(r, g, b, var(--x))` のように色関数の中に `var()` を入れた宣言を無効と
 * みなして落とすことがあり、変数を分けると本番だけ色が消える (canvastage の知見)。
 */

import type { EditorSettings } from "./definitions";

/** `#rrggbb` と不透明度から `rgb(r g b / a)` を作る。色は検証済みの前提。 */
function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * 当てるべき CSS 変数の一覧。
 *
 * DOM を触らないので、値の組み立て (合成した色・単位) をブラウザ無しで確かめられる。
 */
export function cssVariablesFor(
  settings: EditorSettings
): Record<string, string> {
  return {
    "--editor-text-opacity": `${settings.textOpacity}`,
    "--editor-text-shadow-blur": `${settings.textShadowBlur}px`,
    "--editor-text-shadow-color": settings.textShadowColor,

    "--editor-line-number-color": withAlpha(
      "#ffffff",
      settings.lineNumberOpacity
    ),

    // カーソルの幅は CSS に出さない (Monaco 側のオプションで持つ)。
    "--editor-cursor-bg": withAlpha(
      settings.cursorColor,
      settings.cursorOpacity
    ),

    "--editor-selection-bg": withAlpha("#ffffff", settings.selectionOpacity),

    "--editor-current-line-bg": withAlpha(
      settings.currentLineColor,
      settings.currentLineOpacity
    ),

    "--editor-suggest-bg": withAlpha(
      "#000000",
      settings.suggestBackgroundOpacity
    ),
    "--editor-suggest-blur": `${settings.suggestBlur}px`,
    "--editor-suggest-text-color": withAlpha(
      "#ffffff",
      settings.suggestTextOpacity
    ),
  };
}

/** CSS 変数を当てる。既定と同じ値でも書き込む (前の設定を確実に上書きするため)。 */
export function applyCssVariables(
  settings: EditorSettings,
  root: HTMLElement = document.documentElement
): void {
  for (const [name, value] of Object.entries(cssVariablesFor(settings))) {
    root.style.setProperty(name, value);
  }
}
