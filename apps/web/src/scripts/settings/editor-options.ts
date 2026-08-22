/**
 * 設定 → Monaco のオプション。
 *
 * CSS で触れる層は css-variables.ts が持ち、ここは **Monaco が自前で管理する層**
 * (フォント・折り返し・ガイド・カーソルの形) だけを組み立てる。両者は
 * 重ならないようにしてある。同じ見た目を CSS と Monaco の両方から指定すると、
 * `!important` の勝ち負けで「設定を変えても片方しか効かない」状態になる。
 *
 * DOM を作らない純関数なので、設定値の翻訳 (真偽値 → Monaco の語彙) を
 * ブラウザ無しで確かめられる。
 */

import type { editor } from "monaco-editor";

import type { EditorSettings } from "./definitions";

/**
 * 生成時にも更新時にも渡せるオプション。
 *
 * `lineHeight` は Monaco では px。設定の「行の高さ」はフォントサイズに対する
 * 倍率なので、ここで掛けてから渡す。
 */
export function editorOptionsFor(
  settings: EditorSettings
): editor.IEditorOptions & editor.IGlobalEditorOptions {
  return {
    theme: settings.editorTheme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    fontWeight: `${settings.fontWeight}`,
    lineHeight: settings.lineHeight * settings.fontSize,
    wordWrap: settings.wordWrap,
    renderWhitespace: settings.renderWhitespace,
    cursorStyle: settings.cursorStyle,
    cursorBlinking: settings.cursorBlinking,
    // カーソルの幅は Monaco 側に持たせる (CSS で固定すると、ブロックや下線を
    // 選んでも線の幅に潰れる)。Monaco はカーソルが線のときだけこの値を使う。
    cursorWidth: settings.cursorWidth,
    // 対応括弧の強調は既定 off。スケッチの上では、動く枠は文字より目に付く。
    matchBrackets: settings.bracketMatching ? "always" : "never",
    guides: {
      indentation: settings.indentGuides,
      highlightActiveIndentation: settings.indentGuides,
      bracketPairs: settings.bracketPairGuides,
      highlightActiveBracketPair: settings.bracketPairGuides,
    },
    smoothScrolling: settings.smoothScrolling,
    stickyScroll: { enabled: settings.stickyScroll },
  };
}

/**
 * モデル側のオプション。
 *
 * Monaco の中はさらに**エディタが持つ層**と**モデルが持つ層**に分かれていて、
 * ここは後者。タブ幅がそうで、括弧の色分けもそうだった (#22)。
 *
 * 括弧の色分けを見ているのは `TextModel` の `bracketPairColorizationOptions` で、
 * 既定は有効。`monaco.editor.create()` に `bracketPairColorization` を渡しても、
 * その値をモデルへ配るのは configuration service を読む `ModelService` だけなので、
 * 自前で作ったモデル (code-editor.ts) には届かない — **エディタのオプションとしては
 * 無効になるのに括弧は色付いたまま**、という食い違いになる。
 *
 * 色分け自体を出さないのは、スケッチの上に文字を浮かせる構成 (要件 3.1) で
 * 文字以外の装飾を描かない方針に揃えるため。
 */
export function modelOptionsFor(
  settings: EditorSettings
): editor.ITextModelUpdateOptions {
  return {
    tabSize: settings.tabSize,
    insertSpaces: true,
    bracketColorizationOptions: {
      enabled: false,
      independentColorPoolPerBracketType: false,
    },
  };
}
