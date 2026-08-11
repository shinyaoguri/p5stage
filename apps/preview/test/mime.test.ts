import { describe, expect, it } from "vitest";

import { mimeForFileName } from "../client/src/mime";

describe("mimeForFileName", () => {
  it("link / script が受け付ける型を返す", () => {
    expect(mimeForFileName("style.css")).toBe("text/css");
    expect(mimeForFileName("sketch.js")).toBe("text/javascript");
  });

  it("拡張子の大文字小文字を区別しない", () => {
    expect(mimeForFileName("STYLE.CSS")).toBe("text/css");
  });

  it("ブラウザが文書として解釈する型は割り当てない (要件 3.3)", () => {
    expect(mimeForFileName("evil.svg")).toBe("text/plain");
    expect(mimeForFileName("evil.html")).toBe("text/plain");
  });

  it("拡張子が無いものと未知のものは平文にする", () => {
    expect(mimeForFileName("LICENSE")).toBe("text/plain");
    expect(mimeForFileName("data.unknown")).toBe("text/plain");
  });
});
