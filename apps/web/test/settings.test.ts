import { describe, expect, it } from "vitest";

import {
  SETTING_DEFS,
  SETTING_GROUPS,
  type SettingKey,
} from "../src/scripts/settings/definitions";
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  withSetting,
} from "../src/scripts/settings/settings";

describe("設定の宣言", () => {
  it("すべての項目がちょうど 1 度だけ設定パネルに並ぶ", () => {
    // 項目を足したのにグループへ入れ忘れると、既定値だけあって
    // 誰も触れない設定になる (定義とパネルが乖離する最初の一歩)。
    const listed = SETTING_GROUPS.flatMap((group) => group.keys);
    const defined = Object.keys(SETTING_DEFS) as SettingKey[];

    expect([...listed].sort()).toEqual([...defined].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("数値の既定値は範囲の中にある", () => {
    for (const [key, def] of Object.entries(SETTING_DEFS)) {
      if (def.kind !== "number") continue;
      expect(def.min, key).toBeLessThanOrEqual(def.default);
      expect(def.max, key).toBeGreaterThanOrEqual(def.default);
    }
  });

  it("選択肢を持つ項目の既定値はその選択肢にある", () => {
    for (const [key, def] of Object.entries(SETTING_DEFS)) {
      if (def.kind !== "enum") continue;
      expect(
        def.options.map((option) => option.value),
        key
      ).toContain(def.default);
    }
  });
});

describe("sanitizeSettings", () => {
  it("何も無ければ既定になる", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("settings")).toEqual(DEFAULT_SETTINGS);
  });

  it("保存された値を活かす", () => {
    const settings = sanitizeSettings({ fontSize: 20, indentGuides: true });
    expect(settings.fontSize).toBe(20);
    expect(settings.indentGuides).toBe(true);
  });

  it("範囲の外に出た数値は丸める (捨てない)", () => {
    // 範囲を後から狭めたときに、触っていない設定が既定へ飛ばないようにする。
    expect(sanitizeSettings({ fontSize: 999 }).fontSize).toBe(48);
    expect(sanitizeSettings({ fontSize: 1 }).fontSize).toBe(10);
  });

  it("数値にならない値は既定へ倒す", () => {
    expect(sanitizeSettings({ fontSize: "20" }).fontSize).toBe(
      DEFAULT_SETTINGS.fontSize
    );
    expect(sanitizeSettings({ fontSize: Number.NaN }).fontSize).toBe(
      DEFAULT_SETTINGS.fontSize
    );
    expect(
      sanitizeSettings({ fontSize: Number.POSITIVE_INFINITY }).fontSize
    ).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it("知らない選択肢は既定へ倒す", () => {
    expect(sanitizeSettings({ wordWrap: "on" }).wordWrap).toBe("on");
    expect(sanitizeSettings({ wordWrap: "bounded" }).wordWrap).toBe(
      DEFAULT_SETTINGS.wordWrap
    );
    expect(sanitizeSettings({ editorTheme: "light" }).editorTheme).toBe(
      DEFAULT_SETTINGS.editorTheme
    );
  });

  it("色は #rrggbb だけを受ける", () => {
    expect(sanitizeSettings({ cursorColor: "#FF00AA" }).cursorColor).toBe(
      "#ff00aa"
    );
    for (const invalid of ["#fff", "red", "rgb(255 0 0)", "#12345g"]) {
      expect(sanitizeSettings({ cursorColor: invalid }).cursorColor).toBe(
        DEFAULT_SETTINGS.cursorColor
      );
    }
  });

  /**
   * 既定の書体を変えたときの引き継ぎ。
   *
   * 設定は書いた時点の値をそのまま持つので、これが無いと**一度でも開いた人には
   * 古い書体が残り続ける**。既定を変えた意味がその人にだけ届かない。
   */
  it("前の既定のままの書体は今の既定へ引き継ぐ (触った値はそのまま)", () => {
    expect(
      sanitizeSettings({
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }).fontFamily
    ).toBe(DEFAULT_SETTINGS.fontFamily);

    // 自分で選んだ書体は動かさない。前の既定を含んでいても、同じでなければ別物。
    expect(sanitizeSettings({ fontFamily: "Menlo" }).fontFamily).toBe("Menlo");
    expect(
      sanitizeSettings({ fontFamily: "Iosevka, ui-monospace, monospace" })
        .fontFamily
    ).toBe("Iosevka, ui-monospace, monospace");
  });

  it("フォント名は前後の空白を落とし、空や長すぎるものは既定へ倒す", () => {
    expect(sanitizeSettings({ fontFamily: "  Menlo  " }).fontFamily).toBe(
      "Menlo"
    );
    expect(sanitizeSettings({ fontFamily: "   " }).fontFamily).toBe(
      DEFAULT_SETTINGS.fontFamily
    );
    expect(sanitizeSettings({ fontFamily: "a".repeat(257) }).fontFamily).toBe(
      DEFAULT_SETTINGS.fontFamily
    );
  });

  it("壊れているキーだけを既定へ倒し、他は残す", () => {
    // 1 項目の不整合で設定 1 式が失われると、調整し直しになる。
    const settings = sanitizeSettings({
      fontSize: 22,
      cursorColor: "まっしろ",
      wordWrap: "off",
    });
    expect(settings.fontSize).toBe(22);
    expect(settings.wordWrap).toBe("off");
    expect(settings.cursorColor).toBe(DEFAULT_SETTINGS.cursorColor);
  });

  /**
   * 公開範囲だけは**作品の作られ方**を決める (#87 の段階 5)。
   *
   * 他の項目は壊れても見た目が既定に戻るだけだが、これは Gist が public として
   * 作られるか secret として作られるかを左右し、作った後は変えられない
   * (ADR 0010)。倒れる先を名指しで固定しておく。
   */
  it("公開範囲は保存された値を活かし、知らない値は既定へ倒す", () => {
    expect(DEFAULT_SETTINGS.defaultVisibility).toBe("public");
    expect(
      sanitizeSettings({ defaultVisibility: "unlisted" }).defaultVisibility
    ).toBe("unlisted");
    // `private` は p5stage に無い (要件 3.4)。知らない値は既定へ。
    expect(
      sanitizeSettings({ defaultVisibility: "private" }).defaultVisibility
    ).toBe("public");
  });

  it("知らないキーは持ち込まない", () => {
    const settings = sanitizeSettings({ evil: "x", fontSize: 16 });
    expect(Object.keys(settings).sort()).toEqual(
      Object.keys(SETTING_DEFS).sort()
    );
  });
});

describe("withSetting", () => {
  it("1 項目だけ差し替えた設定を返す (元は変えない)", () => {
    const next = withSetting(DEFAULT_SETTINGS, "fontSize", 24);
    expect(next.fontSize).toBe(24);
    expect(next.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    expect(DEFAULT_SETTINGS.fontSize).not.toBe(24);
  });
});
