import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_DATA,
  DEFAULT_THEME_NAME,
  PALETTES,
  THEME_NAMES,
  createThemeData,
} from "../src/scripts/editor/themes";

describe("エディタのテーマ", () => {
  it("どのテーマでも背景は完全な透明", () => {
    // これが崩れるとスケッチがエディタの面に隠れる (要件 3.1 の前提)。
    const all = [
      DEFAULT_THEME_DATA,
      ...Object.values(PALETTES).map(createThemeData),
    ];
    for (const theme of all) {
      expect(theme.colors["editor.background"]).toBe("#00000000");
    }
  });

  it("パレットの色をトークンの色として持ち込む", () => {
    const theme = createThemeData(PALETTES["dracula"]!);
    const keyword = theme.rules.find((rule) => rule.token === "keyword");
    expect(keyword?.foreground).toBe("FF79C6");
  });

  it("前景色は未指定なら既定色にする", () => {
    const withForeground = createThemeData(PALETTES["nord"]!);
    const withoutForeground = createThemeData(PALETTES["monokai"]!);
    expect(withForeground.colors["editor.foreground"]).toBe("#D8DEE9");
    expect(withoutForeground.colors["editor.foreground"]).toBe("#F8F8F2");
  });

  it("カーソル行の色はパレットが指定したときだけ差し替える", () => {
    const overridden = createThemeData(PALETTES["cyberpunk"]!);
    const inherited = createThemeData(PALETTES["monokai"]!);
    expect(overridden.colors["editor.lineHighlightBackground"]).toBe(
      "#ff2a6d10"
    );
    expect(inherited.colors["editor.lineHighlightBackground"]).toBe(
      "#ffffff08"
    );
  });

  it("テーマ名の一覧は既定テーマを先頭に、パレットを重複なく並べる", () => {
    expect(THEME_NAMES[0]).toBe(DEFAULT_THEME_NAME);
    expect(THEME_NAMES).toHaveLength(Object.keys(PALETTES).length + 1);
    expect(new Set(THEME_NAMES).size).toBe(THEME_NAMES.length);
  });
});
