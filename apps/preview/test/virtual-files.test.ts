import { describe, expect, it } from "vitest";

import { buildRuntimeUrlMap } from "../client/src/virtual-files";

const base = "https://preview.example/runner/";

describe("buildRuntimeUrlMap", () => {
  it("相対参照が解決される絶対 URL を鍵にする", () => {
    const map = buildRuntimeUrlMap(
      new Map([["data.json", "blob:https://preview.example/1"]]),
      base
    );

    expect(map).toEqual({
      "https://preview.example/runner/data.json":
        "blob:https://preview.example/1",
    });
  });

  it("ベース URL の位置を反映する (別ディレクトリの同名ファイルと混ざらない)", () => {
    const map = buildRuntimeUrlMap(
      new Map([["data.json", "blob:1"]]),
      "https://preview.example/other/index.html"
    );

    expect(map["https://preview.example/other/data.json"]).toBe("blob:1");
    expect(map["https://preview.example/runner/data.json"]).toBeUndefined();
  });

  it("ベース URL が壊れていても他のファイルを巻き込まない", () => {
    expect(
      buildRuntimeUrlMap(new Map([["a.json", "blob:1"]]), "not a url")
    ).toEqual({});
  });
});
