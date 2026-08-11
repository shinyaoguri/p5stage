/**
 * 実行ショートカット (⌘/Ctrl+Enter) の判定。
 *
 * Monaco の `KeyMod.CtrlCmd` は mac で ⌘ にだけ割り当たり物理 Ctrl を拾わないため、
 * キーバインドではなく keydown を直接見て全 OS で両方の修飾を受け付ける
 * (移植元 canvastage と同じ判断)。判定だけを純関数にして、IME の除外を
 * ブラウザ無しで検証できるようにしている。
 */

/** 判定に使う keydown の部分集合 (KeyboardEvent はこれを満たす)。 */
export interface RunShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
  /** 旧 API の keyCode。IME 変換中は 229 が入る。 */
  readonly keyCode: number;
}

/** IME 変換中を示す旧 keyCode。isComposing が立たないブラウザの取りこぼし対策。 */
const IME_KEY_CODE = 229;

/**
 * この keydown が「実行」か。
 *
 * IME 変換中の Enter は候補の確定であって実行ではないので弾く。
 */
export function isRunShortcut(event: RunShortcutEvent): boolean {
  if (event.isComposing || event.keyCode === IME_KEY_CODE) return false;
  if (event.key !== "Enter") return false;
  return event.ctrlKey || event.metaKey;
}
