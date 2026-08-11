/**
 * 設定の既定値と検証。
 *
 * 保存済みの設定は「前のバージョンの p5stage が書いたもの」かもしれず、
 * 項目の増減・範囲の変更・手で書き換えられた値が混ざりうる。読み込みは必ず
 * ここを通し、**壊れているキーだけを既定に倒して残りは活かす**。
 * 設定 1 つの不整合でエディタが開かなくなる方が困る。
 */

import {
  SETTING_DEFS,
  type EditorSettings,
  type SettingDef,
  type SettingKey,
} from "./definitions";

/** 自由入力の上限。CSS の font-family として流すので、無制限には受けない。 */
const MAX_TEXT_LENGTH = 256;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * 値 1 つを扱える形に直す。判断できない値は定義の既定へ倒す。
 *
 * 数値は範囲外でも捨てずに丸める。スライダーの範囲を後から狭めたときに、
 * 前の設定が丸ごと既定へ戻ると「触っていないのに見た目が変わった」になる。
 */
function sanitizeValue(
  def: SettingDef,
  value: unknown
): number | boolean | string {
  switch (def.kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? Math.min(def.max, Math.max(def.min, value))
        : def.default;
    case "boolean":
      return typeof value === "boolean" ? value : def.default;
    case "enum":
      return typeof value === "string" &&
        def.options.some((option) => option.value === value)
        ? value
        : def.default;
    case "color":
      return typeof value === "string" && HEX_COLOR.test(value)
        ? value.toLowerCase()
        : def.default;
    case "text": {
      if (typeof value !== "string") return def.default;
      const trimmed = value.trim();
      return trimmed !== "" && trimmed.length <= MAX_TEXT_LENGTH
        ? trimmed
        : def.default;
    }
  }
}

/**
 * 任意の入力を設定 1 式に直す。未知のキーは落ちる。
 *
 * キーごとに値の型が違うため、組み立ては `Record<string, unknown>` で行って
 * 最後に 1 度だけ表明する。中身は `SETTING_DEFS` を回して埋めているので、
 * キーの過不足は起きない。
 */
export function sanitizeSettings(input: unknown): EditorSettings {
  const source =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  const result: Record<string, number | boolean | string> = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    result[key] = sanitizeValue(def, source[key]);
  }
  return result as EditorSettings;
}

/** 既定の設定。定義テーブルから作るので、既定値の二重管理は生まれない。 */
export const DEFAULT_SETTINGS: EditorSettings = sanitizeSettings({});

/** 1 項目だけ差し替えた設定を返す (設定は読み取り専用で持ち回る)。 */
export function withSetting<K extends SettingKey>(
  settings: EditorSettings,
  key: K,
  value: EditorSettings[K]
): EditorSettings {
  return { ...settings, [key]: value };
}
