/**
 * 中身と申告された形式の突き合わせ (Phase 3-1)。
 *
 * `Content-Type` は送り手の自己申告でしかない。ここを外すと「png として保存したのに
 * png ではない」作品が作れてしまい、壊れていることに気付くのは**閲覧者が見たとき**に
 * なる。署名の決まっている形式は受け取った時点で弾く。
 */

import { describe, expect, it } from "vitest";

import { matchesDeclaredType } from "../src/lib/assets/sniff";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const GIF = new TextEncoder().encode("GIF89a....");
const HTML = new TextEncoder().encode(
  "<!doctype html><script>alert(1)</script>"
);

function riff(form: string): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode(form), 8);
  return bytes;
}

describe("matchesDeclaredType", () => {
  it("申告どおりの中身を通す", () => {
    expect(matchesDeclaredType("image/png", PNG)).toBe(true);
    expect(matchesDeclaredType("image/jpeg", JPEG)).toBe(true);
    expect(matchesDeclaredType("image/gif", GIF)).toBe(true);
    expect(matchesDeclaredType("image/webp", riff("WEBP"))).toBe(true);
    expect(matchesDeclaredType("audio/wav", riff("WAVE"))).toBe(true);
    expect(
      matchesDeclaredType("audio/ogg", new TextEncoder().encode("OggS...."))
    ).toBe(true);
    expect(
      matchesDeclaredType("model/gltf-binary", new TextEncoder().encode("glTF"))
    ).toBe(true);
  });

  it("画像と偽った HTML を弾く", () => {
    // allowlist だけでは通ってしまう経路。ここが最後の砦。
    expect(matchesDeclaredType("image/png", HTML)).toBe(false);
    expect(matchesDeclaredType("image/jpeg", HTML)).toBe(false);
    expect(matchesDeclaredType("image/gif", HTML)).toBe(false);
    expect(matchesDeclaredType("audio/ogg", HTML)).toBe(false);
  });

  it("形式どうしの取り違えを弾く", () => {
    expect(matchesDeclaredType("image/png", JPEG)).toBe(false);
    expect(matchesDeclaredType("image/webp", riff("WAVE"))).toBe(false);
    expect(matchesDeclaredType("audio/wav", riff("WEBP"))).toBe(false);
  });

  it("短すぎる中身を通さない", () => {
    expect(matchesDeclaredType("image/png", new Uint8Array([0x89]))).toBe(
      false
    );
    expect(matchesDeclaredType("image/png", new Uint8Array())).toBe(false);
  });

  it("MP3 はタグ付きもフレーム同期から始まるものも通す", () => {
    expect(
      matchesDeclaredType("audio/mpeg", new TextEncoder().encode("ID3"))
    ).toBe(true);
    expect(
      matchesDeclaredType("audio/mpeg", new Uint8Array([0xff, 0xfb, 0x90]))
    ).toBe(true);
    expect(
      matchesDeclaredType("audio/mpeg", new Uint8Array([0xff, 0x01, 0x02]))
    ).toBe(false);
  });

  it("フォントは TrueType も OpenType (CFF) も通す", () => {
    // 拡張子と中身の対応は実運用で入れ替わっているので、SFNT なら通す。
    expect(
      matchesDeclaredType("font/ttf", new Uint8Array([0x00, 0x01, 0x00, 0x00]))
    ).toBe(true);
    expect(
      matchesDeclaredType("font/otf", new TextEncoder().encode("OTTO"))
    ).toBe(true);
    expect(matchesDeclaredType("font/otf", HTML)).toBe(false);
  });

  it("署名を持たないテキスト形式は素通しする", () => {
    // 中身の妥当性まで見ると「読めるが仕様外」を弾いて利用者を困らせる。
    const text = new TextEncoder().encode("x,y\n1,2\n");

    expect(matchesDeclaredType("text/csv", text)).toBe(true);
    expect(matchesDeclaredType("text/plain", text)).toBe(true);
    expect(matchesDeclaredType("application/json", text)).toBe(true);
    expect(matchesDeclaredType("model/obj", text)).toBe(true);
    expect(matchesDeclaredType("model/gltf+json", text)).toBe(true);
  });
});
