import { describe, expect, it } from "vitest";

import {
  WEB_ORIGIN_PLACEHOLDER,
  injectWebOrigin,
  isHtmlResponse,
} from "../src/inject-origin";

describe("injectWebOrigin", () => {
  it("プレースホルダを実値に置き換える", () => {
    const html = `<meta name="p5stage-web-origin" content="${WEB_ORIGIN_PLACEHOLDER}" />`;
    expect(injectWebOrigin(html, "https://p5stage.example")).toBe(
      '<meta name="p5stage-web-origin" content="https://p5stage.example" />'
    );
  });

  it("プレースホルダが複数あってもすべて置き換える", () => {
    const html = `${WEB_ORIGIN_PLACEHOLDER}/${WEB_ORIGIN_PLACEHOLDER}`;
    expect(injectWebOrigin(html, "https://a.example")).toBe(
      "https://a.example/https://a.example"
    );
  });

  it("属性を抜け出す文字を無害化する", () => {
    const result = injectWebOrigin(
      `content="${WEB_ORIGIN_PLACEHOLDER}"`,
      'https://a.example" onload="alert(1)'
    );
    expect(result).not.toContain('onload="alert(1)"');
    expect(result).toContain("&quot;");
  });

  it("プレースホルダが無ければ何もしない", () => {
    expect(injectWebOrigin("<p>hi</p>", "https://a.example")).toBe("<p>hi</p>");
  });
});

describe("isHtmlResponse", () => {
  it("HTML を判別する", () => {
    expect(
      isHtmlResponse(
        new Response("", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      )
    ).toBe(true);
  });

  it("HTML 以外を対象にしない", () => {
    expect(
      isHtmlResponse(
        new Response("", { headers: { "Content-Type": "text/javascript" } })
      )
    ).toBe(false);
    expect(isHtmlResponse(new Response(""))).toBe(false);
  });
});
