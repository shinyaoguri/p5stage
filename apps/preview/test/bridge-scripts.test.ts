import { describe, expect, it } from "vitest";

import {
  consoleBridgeScript,
  fileLoaderBridgeScript,
  serializeForScript,
} from "../client/src/bridge-scripts";

describe("serializeForScript", () => {
  it("script タグを閉じる文字列を無害化する", () => {
    const serialized = serializeForScript({
      "a.js": "</script><script>evil()",
    });
    expect(serialized).not.toContain("</script>");
    expect(JSON.parse(serialized)).toEqual({
      "a.js": "</script><script>evil()",
    });
  });

  it("JS の行終端として解釈される区切り文字を潰す", () => {
    const separators =
      String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    const serialized = serializeForScript(separators);
    expect(serialized).not.toContain(String.fromCharCode(0x2028));
    expect(serialized).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(serialized)).toBe(separators);
  });
});

describe("consoleBridgeScript", () => {
  it("転送先オリジンを埋め込む", () => {
    expect(consoleBridgeScript("https://preview.example")).toContain(
      '"https://preview.example"'
    );
  });

  it("転送先に * を使わない", () => {
    expect(consoleBridgeScript("https://preview.example")).not.toContain('"*"');
  });
});

describe("fileLoaderBridgeScript", () => {
  it("対応表を埋め込む", () => {
    const script = fileLoaderBridgeScript({
      "https://preview.example/runner/data.json":
        "blob:https://preview.example/1",
    });
    expect(script).toContain("blob:https://preview.example/1");
  });

  it("対応表の内容が script タグを閉じない", () => {
    const script = fileLoaderBridgeScript({
      "https://preview.example/runner/</script>": "blob:x",
    });
    expect(script.indexOf("</script>")).toBe(script.lastIndexOf("</script>"));
  });
});
