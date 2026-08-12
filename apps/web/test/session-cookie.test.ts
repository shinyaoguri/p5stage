/**
 * セッション cookie の属性と読み取り (ADR 0008)。
 *
 * `__Host-` プレフィックスは「Secure かつ Path=/ かつ Domain 属性なし」を満たすときだけ
 * ブラウザが受け付ける。実行オリジンが same-site サブドメインにある以上、この 3 条件が
 * **サブドメインから cookie を上書きされない**唯一の担保なので、属性を落としていないかを見る。
 */

import { describe, expect, it } from "vitest";

import {
  buildClearedSessionCookie,
  buildClearedStateCookie,
  buildSessionCookie,
  buildStateCookie,
  readCookie,
  SESSION_COOKIE,
  STATE_COOKIE,
} from "../src/lib/session/cookie";

describe("cookie の名前", () => {
  it("どちらも __Host- プレフィックスを持つ", () => {
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(STATE_COOKIE.startsWith("__Host-")).toBe(true);
  });
});

describe("発行する Set-Cookie", () => {
  const requiredAttributes = ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"];

  it.each([
    ["セッション", buildSessionCookie("abc")],
    ["state", buildStateCookie("xyz")],
    ["セッションの消去", buildClearedSessionCookie()],
    ["state の消去", buildClearedStateCookie()],
  ])("%s は __Host- の要件を満たす", (_label, cookie) => {
    for (const attribute of requiredAttributes) {
      expect(cookie).toContain(attribute);
    }
    // Domain を付けると __Host- の要件を外れ、サブドメインから触れるようになる。
    expect(cookie).not.toContain("Domain=");
  });

  it("値を載せる", () => {
    expect(buildSessionCookie("abc")).toContain(`${SESSION_COOKIE}=abc`);
    expect(buildStateCookie("xyz")).toContain(`${STATE_COOKIE}=xyz`);
  });

  it("消去は Max-Age=0 で即時に落とす", () => {
    expect(buildClearedSessionCookie()).toContain("Max-Age=0");
    expect(buildClearedStateCookie()).toContain("Max-Age=0");
  });

  it("セッションには寿命がある", () => {
    expect(buildSessionCookie("abc")).toMatch(/Max-Age=\d+/);
    expect(buildSessionCookie("abc")).not.toContain("Max-Age=0");
  });
});

describe("Cookie ヘッダの読み取り", () => {
  it("目的の 1 つを取り出す", () => {
    const header = `other=1; ${SESSION_COOKIE}=value; another=2`;
    expect(readCookie(header, SESSION_COOKIE)).toBe("value");
  });

  it("前後の空白を落とす", () => {
    expect(readCookie(`  ${SESSION_COOKIE}=value  `, SESSION_COOKIE)).toBe(
      "value"
    );
  });

  it("無ければ null", () => {
    expect(readCookie("other=1", SESSION_COOKIE)).toBeNull();
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
  });

  it("空の値は無いものとして扱う", () => {
    expect(readCookie(`${SESSION_COOKIE}=`, SESSION_COOKIE)).toBeNull();
  });

  it("名前が重複していたら最初のものを採る", () => {
    // cookie tossing で同名が差し込まれても、挙動が定まっていること。
    const header = `${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`;
    expect(readCookie(header, SESSION_COOKIE)).toBe("first");
  });

  it("前方一致する別の名前を拾わない", () => {
    const header = `${SESSION_COOKIE}_other=wrong; ${SESSION_COOKIE}=right`;
    expect(readCookie(header, SESSION_COOKIE)).toBe("right");
  });
});
