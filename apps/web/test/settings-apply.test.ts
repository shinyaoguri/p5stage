import { describe, expect, it } from "vitest";

import { cssVariablesFor } from "../src/scripts/settings/css-variables";
import {
  editorOptionsFor,
  modelOptionsFor,
} from "../src/scripts/settings/editor-options";
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
} from "../src/scripts/settings/settings";

describe("cssVariablesFor", () => {
  it("色と不透明度を 1 つの色文字列に合成する", () => {
    // CSS 側で rgb() の中に var() を入れるとミニファイアに落とされるため、
    // 合成済みの値を渡すことが前提になっている。
    const variables = cssVariablesFor(
      sanitizeSettings({ cursorColor: "#ff8800", cursorOpacity: 0.5 })
    );
    expect(variables["--editor-cursor-bg"]).toBe("rgb(255 136 0 / 0.5)");
  });

  it("長さには単位を付ける", () => {
    const variables = cssVariablesFor(
      sanitizeSettings({ textShadowBlur: 6, suggestBlur: 0 })
    );
    expect(variables["--editor-text-shadow-blur"]).toBe("6px");
    expect(variables["--editor-suggest-blur"]).toBe("0px");
  });

  it("行番号・選択範囲は白を基準にする", () => {
    const variables = cssVariablesFor(
      sanitizeSettings({ lineNumberOpacity: 0.25, selectionOpacity: 0.3 })
    );
    expect(variables["--editor-line-number-color"]).toBe(
      "rgb(255 255 255 / 0.25)"
    );
    expect(variables["--editor-selection-bg"]).toBe("rgb(255 255 255 / 0.3)");
  });

  it("editor-overlay.css が読む変数をすべて埋める", () => {
    // 変数が欠けると、その項目だけ前の設定が残り続ける。
    expect(Object.keys(cssVariablesFor(DEFAULT_SETTINGS)).sort()).toEqual([
      "--editor-current-line-bg",
      "--editor-cursor-bg",
      "--editor-line-number-color",
      "--editor-selection-bg",
      "--editor-suggest-bg",
      "--editor-suggest-blur",
      "--editor-suggest-text-color",
      "--editor-text-opacity",
      "--editor-text-shadow-blur",
      "--editor-text-shadow-color",
    ]);
  });
});

describe("editorOptionsFor", () => {
  it("行の高さは倍率から px に直す", () => {
    // Monaco の lineHeight は px。倍率のまま渡すと 1.5px の行になる。
    const options = editorOptionsFor(
      sanitizeSettings({ fontSize: 20, lineHeight: 1.5 })
    );
    expect(options.lineHeight).toBe(30);
  });

  it("括弧の強調を Monaco の語彙に直す", () => {
    expect(
      editorOptionsFor(sanitizeSettings({ bracketMatching: true }))
        .matchBrackets
    ).toBe("always");
    expect(
      editorOptionsFor(sanitizeSettings({ bracketMatching: false }))
        .matchBrackets
    ).toBe("never");
  });

  it("ガイドは有効なときだけ現在位置も強調する", () => {
    const on = editorOptionsFor(
      sanitizeSettings({ indentGuides: true, bracketPairGuides: false })
    );
    expect(on.guides).toEqual({
      indentation: true,
      highlightActiveIndentation: true,
      bracketPairs: false,
      highlightActiveBracketPair: false,
    });
  });

  it("カーソルの幅は Monaco 側に渡す (CSS では固定しない)", () => {
    // CSS で幅を固定すると、ブロックや下線を選んでも線の幅に潰れる。
    expect(
      editorOptionsFor(sanitizeSettings({ cursorWidth: 3 })).cursorWidth
    ).toBe(3);
    expect(cssVariablesFor(DEFAULT_SETTINGS)["--editor-cursor-width"]).toBe(
      undefined
    );
  });
});

describe("modelOptionsFor", () => {
  it("タブ幅はモデル側のオプションになる", () => {
    expect(modelOptionsFor(sanitizeSettings({ tabSize: 4 }))).toEqual({
      tabSize: 4,
      insertSpaces: true,
    });
  });
});
