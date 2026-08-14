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

/**
 * 差し替えが**実際に効くか**を、注入するスクリプトをそのまま走らせて確かめる。
 *
 * 中身は「script タグの文字列」なので、含まれる字面を見るテストでは
 * 「fetch は直したが img は直っていない」を見逃す。ブラウザの代わりに最小の
 * 差し替え先 (window / document / 各 prototype) を与えて動かす。
 */
describe("fileLoaderBridgeScript (実行)", () => {
  const BASE = "https://preview.example/runner/";
  const MAPPED = "https://assets.example/a/abc/cat.png";

  /** `src` を素直に覚えるだけの prototype。差し替えの土台になる。 */
  function createElementClass(): new () => { src: string } {
    class FakeElement {
      declare _src: string;
    }
    Object.defineProperty(FakeElement.prototype, "src", {
      configurable: true,
      enumerable: true,
      get(this: { _src?: string }) {
        return this._src ?? "";
      },
      set(this: { _src?: string }, value: string) {
        this._src = value;
      },
    });
    return FakeElement as unknown as new () => { src: string };
  }

  interface Sandbox {
    readonly image: { src: string };
    /** setAttribute で書き込まれた属性。 */
    readonly attributes: Record<string, string>;
    readonly fetched: string[];
    readonly opened: string[];
  }

  /** ブリッジを走らせた後の差し替え先を返す。 */
  function runBridge(urls: Record<string, string>): Sandbox {
    const body = fileLoaderBridgeScript(urls)
      .replace(/^<script>/, "")
      .replace(/<\/script>$/, "");

    const fetched: string[] = [];
    const opened: string[] = [];

    const ImageElement = createElementClass();
    const MediaElement = createElementClass();
    const SourceElement = createElementClass();

    class FakeXhr {
      open(_method: string, url: string): void {
        opened.push(url);
      }
    }

    const attributes: Record<string, string> = {};
    class FakeNode {
      setAttribute(name: string, value: string): void {
        attributes[name] = value;
      }
    }

    const win = {
      fetch: (input: string) => {
        fetched.push(input);
        return Promise.resolve(null);
      },
      HTMLImageElement: ImageElement,
      HTMLMediaElement: MediaElement,
      HTMLSourceElement: SourceElement,
    };

    new Function(
      "window",
      "document",
      "XMLHttpRequest",
      "Element",
      "HTMLImageElement",
      "HTMLMediaElement",
      "HTMLSourceElement",
      body
    )(
      win,
      { baseURI: BASE },
      FakeXhr,
      FakeNode,
      ImageElement,
      MediaElement,
      SourceElement
    );

    const image = new ImageElement();
    const element = new FakeNode();
    const xhr = new FakeXhr();

    void win.fetch("cat.png");
    void win.fetch("other.png");
    xhr.open("GET", "cat.png");
    image.src = "cat.png";
    element.setAttribute("src", "cat.png");
    element.setAttribute("alt", "cat.png");

    return { image, attributes, fetched, opened };
  }

  const sandbox = (): Sandbox => runBridge({ [`${BASE}cat.png`]: MAPPED });

  it("fetch の宛先を振り替える", () => {
    expect(sandbox().fetched).toEqual([MAPPED, "other.png"]);
  });

  it("XMLHttpRequest の宛先を振り替える", () => {
    expect(sandbox().opened).toEqual([MAPPED]);
  });

  // p5 1.x の loadImage は GIF 判定の fetch の後、img.src に元のパスを渡す。
  // ここが効かないと画像が読めない (ADR 0014)。
  it("img.src の代入を振り替える", () => {
    expect(sandbox().image.src).toBe(MAPPED);
  });

  it("setAttribute の src を振り替え、他の属性は触らない", () => {
    const { attributes } = sandbox();
    expect(attributes.src).toBe(MAPPED);
    expect(attributes.alt).toBe("cat.png");
  });

  it("表に無い参照はそのまま通す", () => {
    const { image, fetched } = runBridge({});
    expect(image.src).toBe("cat.png");
    expect(fetched).toEqual(["cat.png", "other.png"]);
  });
});
