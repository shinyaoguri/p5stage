/**
 * セッション ID の扱いとトークンの封筒 (ADR 0009)。
 *
 * ここが守っているのは「DB が漏れても被害が広がらない」という性質なので、
 * 「往復できる」だけでなく **DB に置く値から元が復元できない** ことを見る。
 */

import { describe, expect, it } from "vitest";

import {
  deriveTokenKey,
  generateSessionId,
  hashSessionId,
  openToken,
  sealToken,
  SealedTokenError,
} from "../src/lib/session/crypto";

const SECRET = "test-client-secret";

describe("セッション ID", () => {
  it("毎回違う値になる", () => {
    const ids = new Set(Array.from({ length: 32 }, () => generateSessionId()));
    expect(ids.size).toBe(32);
  });

  it("32 バイトの hex になる", () => {
    expect(generateSessionId()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じ ID からは同じハッシュが出る (突き合わせに使える)", async () => {
    const raw = generateSessionId();
    expect(await hashSessionId(raw)).toBe(await hashSessionId(raw));
  });

  it("DB に置く値から cookie の値は復元できない", async () => {
    const raw = generateSessionId();
    const hashed = await hashSessionId(raw);

    // ハッシュそのものが cookie の値と一致していたら、DB の漏洩が
    // そのままセッションの乗っ取りになる。
    expect(hashed).not.toBe(raw);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("トークンの封筒", () => {
  it("同じ鍵で開けられる", async () => {
    const key = await deriveTokenKey(SECRET);
    const sealed = await sealToken(key, "gho_example");

    expect(await openToken(key, sealed)).toBe("gho_example");
  });

  it("封筒の中身に平文は現れない", async () => {
    const key = await deriveTokenKey(SECRET);
    const sealed = await sealToken(key, "gho_example");

    const asText = new TextDecoder().decode(sealed.ciphertext);
    expect(asText).not.toContain("gho_example");
  });

  it("同じトークンでも毎回違う暗号文になる (nonce を使い回さない)", async () => {
    const key = await deriveTokenKey(SECRET);
    const first = await sealToken(key, "gho_example");
    const second = await sealToken(key, "gho_example");

    expect(Array.from(first.iv)).not.toEqual(Array.from(second.iv));
    expect(Array.from(first.ciphertext)).not.toEqual(
      Array.from(second.ciphertext)
    );
  });

  it("鍵が変わると開かない (Client Secret のロテート)", async () => {
    const sealed = await sealToken(await deriveTokenKey(SECRET), "gho_example");
    const otherKey = await deriveTokenKey("rotated-secret");

    await expect(openToken(otherKey, sealed)).rejects.toBeInstanceOf(
      SealedTokenError
    );
  });

  it("改竄された封筒は開かない", async () => {
    const key = await deriveTokenKey(SECRET);
    const sealed = await sealToken(key, "gho_example");

    const tampered = new Uint8Array(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    await expect(
      openToken(key, { ciphertext: tampered, iv: sealed.iv })
    ).rejects.toBeInstanceOf(SealedTokenError);
  });

  it("同じ Client Secret からは同じ鍵が導出される (再起動で開けなくならない)", async () => {
    const sealed = await sealToken(await deriveTokenKey(SECRET), "gho_example");

    expect(await openToken(await deriveTokenKey(SECRET), sealed)).toBe(
      "gho_example"
    );
  });
});
