import { describe, expect, it } from "vitest";

import { OriginConfigError, resolveOrigins } from "../src/origins";

describe("resolveOrigins", () => {
  it("web と preview が別オリジンなら受け入れる", () => {
    expect(
      resolveOrigins({
        web: "https://p5stage.example",
        preview: "https://preview.p5stage.example",
      })
    ).toEqual({
      web: "https://p5stage.example",
      preview: "https://preview.p5stage.example",
      assets: null,
    });
  });

  it("パス・クエリ・末尾スラッシュを落としてオリジンに正規化する", () => {
    expect(
      resolveOrigins({
        web: "https://p5stage.example/",
        preview: "https://preview.p5stage.example/run?x=1",
      })
    ).toEqual({
      web: "https://p5stage.example",
      preview: "https://preview.p5stage.example",
      assets: null,
    });
  });

  it("ポートが違えば別オリジンとして扱う (ローカル開発の構成)", () => {
    expect(
      resolveOrigins({
        web: "http://localhost:4321",
        preview: "http://localhost:8788",
      })
    ).toEqual({
      web: "http://localhost:4321",
      preview: "http://localhost:8788",
      assets: null,
    });
  });

  it("アセットのオリジンも受け入れる (ADR 0014)", () => {
    expect(
      resolveOrigins({
        web: "https://p5stage.example",
        preview: "https://preview.p5stage.example",
        assets: "https://assets.p5stage.example/",
      })
    ).toEqual({
      web: "https://p5stage.example",
      preview: "https://preview.p5stage.example",
      assets: "https://assets.p5stage.example",
    });
  });

  // 実行環境 (preview Worker) は配信先を知らないまま動く。
  it.each([undefined, null])(
    "アセットのオリジンを渡さなければ null (%j)",
    (assets) => {
      expect(
        resolveOrigins({
          web: "https://p5stage.example",
          preview: "https://preview.p5stage.example",
          assets,
        }).assets
      ).toBeNull();
    }
  );

  // 他者がアップロードした中身を、本体からも実行環境からも配らない (ADR 0014)。
  it.each(["https://p5stage.example", "https://preview.p5stage.example"])(
    "アセットが本体・実行環境と同じオリジンなら拒否する (%s)",
    (assets) => {
      expect(() =>
        resolveOrigins({
          web: "https://p5stage.example",
          preview: "https://preview.p5stage.example",
          assets,
        })
      ).toThrow(OriginConfigError);
    }
  );

  it("アセットのオリジンが不正なら拒否する", () => {
    expect(() =>
      resolveOrigins({
        web: "https://p5stage.example",
        preview: "https://preview.p5stage.example",
        assets: "javascript:alert(1)",
      })
    ).toThrow(OriginConfigError);
  });

  it("同一オリジンを拒否する (要件 5.1 の別オリジン実行)", () => {
    expect(() =>
      resolveOrigins({
        web: "https://p5stage.example",
        preview: "https://p5stage.example/preview",
      })
    ).toThrow(OriginConfigError);
  });

  // 未設定の環境変数は空文字や空白として届くので、URL 解析より前に固有の理由で落とす。
  it.each(["", "   "])("空の値を「空です」として拒否する (%j)", (value) => {
    expect(() =>
      resolveOrigins({ web: value, preview: "https://preview.p5stage.example" })
    ).toThrow(/オリジンが空です/);
  });

  it("URL として不正な値を拒否する", () => {
    expect(() =>
      resolveOrigins({
        web: "p5stage.example",
        preview: "https://preview.p5stage.example",
      })
    ).toThrow(OriginConfigError);
  });

  it("http / https 以外のスキームを拒否する", () => {
    expect(() =>
      resolveOrigins({
        web: "https://p5stage.example",
        preview: "javascript:alert(1)",
      })
    ).toThrow(OriginConfigError);
  });
});
