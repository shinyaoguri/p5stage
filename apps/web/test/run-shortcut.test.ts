import { describe, expect, it } from "vitest";

import {
  isRunShortcut,
  type RunShortcutEvent,
} from "../src/scripts/editor/run-shortcut";

function keydown(overrides: Partial<RunShortcutEvent> = {}): RunShortcutEvent {
  return {
    key: "Enter",
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides,
  };
}

describe("isRunShortcut", () => {
  it("⌘+Enter と Ctrl+Enter のどちらでも実行とみなす", () => {
    expect(isRunShortcut(keydown({ metaKey: true }))).toBe(true);
    expect(isRunShortcut(keydown({ ctrlKey: true }))).toBe(true);
  });

  it("修飾の無い Enter は改行なので実行しない", () => {
    expect(isRunShortcut(keydown())).toBe(false);
  });

  it("Enter 以外のキーは修飾があっても実行しない", () => {
    expect(isRunShortcut(keydown({ key: "s", metaKey: true }))).toBe(false);
  });

  it("IME 変換中の Enter は候補の確定なので実行しない", () => {
    expect(isRunShortcut(keydown({ metaKey: true, isComposing: true }))).toBe(
      false
    );
  });

  it("isComposing が立たないブラウザでも keyCode 229 で変換中とみなす", () => {
    expect(isRunShortcut(keydown({ metaKey: true, keyCode: 229 }))).toBe(false);
  });
});
