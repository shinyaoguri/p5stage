import { describe, expect, it } from "vitest";

import { buildSecurityHeaders, withSecurityHeaders } from "../src/headers";

describe("buildSecurityHeaders", () => {
  it("埋め込み元を本体オリジンだけに絞る", () => {
    const headers = buildSecurityHeaders("https://p5stage.example");
    expect(headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors https://p5stage.example"
    );
  });

  it("MIME スニッフィングとリファラ送出を止める", () => {
    const headers = buildSecurityHeaders("https://p5stage.example");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("iframe 埋め込みを一律で禁じない (実行 iframe は埋め込まれる側)", () => {
    const headers = buildSecurityHeaders("https://p5stage.example");
    expect(headers.get("X-Frame-Options")).toBeNull();
  });
});

describe("withSecurityHeaders", () => {
  it("元レスポンスの本文・ステータス・ヘッダを保ったまま重ねる", async () => {
    const original = new Response("<!doctype html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

    const result = withSecurityHeaders(original, "https://p5stage.example");

    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("text/html");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await result.text()).toBe("<!doctype html>");
  });

  it("エラーレスポンスにもヘッダを付ける", () => {
    const result = withSecurityHeaders(
      new Response("not found", { status: 404 }),
      "https://p5stage.example"
    );

    expect(result.status).toBe(404);
    expect(result.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors https://p5stage.example"
    );
  });

  it("元レスポンスが同名ヘッダを持っていれば上書きする", () => {
    const original = new Response("", {
      headers: { "Referrer-Policy": "unsafe-url" },
    });

    const result = withSecurityHeaders(original, "https://p5stage.example");

    expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
