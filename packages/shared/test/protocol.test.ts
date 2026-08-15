import { describe, expect, it } from "vitest";

import { MAX_THUMBNAIL_BYTES } from "../src/thumbnails";

import {
  CHANNEL,
  MIN_RUNNER_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  envelope,
  isSupportedRunnerVersion,
  parseHostMessage,
  parseRunnerMessage,
} from "../src/protocol";
import {
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
} from "../src/transitions";

const files = { "index.html": "<html></html>" };

describe("parseHostMessage", () => {
  it("run を読み取る", () => {
    expect(parseHostMessage(envelope({ type: "run", gen: 3, files }))).toEqual({
      type: "run",
      gen: 3,
      files,
      assets: {},
      transition: null,
    });
  });

  it("run の演出指定を読み取る", () => {
    expect(
      parseHostMessage(
        envelope({
          type: "run",
          gen: 1,
          files,
          transition: { id: "dissolve", durationMs: 300 },
        })
      )
    ).toEqual({
      type: "run",
      gen: 1,
      files,
      assets: {},
      transition: { id: "dissolve", durationMs: 300 },
    });
  });

  it("演出の長さを扱える範囲に丸める", () => {
    const parse = (durationMs: unknown) =>
      parseHostMessage(
        envelope({
          type: "run",
          gen: 1,
          files,
          transition: { id: "dissolve", durationMs },
        })
      );
    expect(parse(10)).toMatchObject({
      transition: { durationMs: MIN_TRANSITION_MS },
    });
    expect(parse(999_999)).toMatchObject({
      transition: { durationMs: MAX_TRANSITION_MS },
    });
    expect(parse("400")).toMatchObject({
      transition: { durationMs: DEFAULT_TRANSITION_MS },
    });
  });

  it("未知の演出は即時切替として扱い、実行そのものは通す", () => {
    for (const transition of [
      { id: "none", durationMs: 400 },
      { id: "explode", durationMs: 400 },
      { durationMs: 400 },
      "dissolve",
      null,
    ]) {
      expect(
        parseHostMessage(envelope({ type: "run", gen: 1, files, transition }))
      ).toEqual({ type: "run", gen: 1, files, assets: {}, transition: null });
    }
  });

  it("アセットの URL 表を読み取る (ADR 0014)", () => {
    const assets = { "cat.png": "https://assets.example/a/abc/cat.png" };
    expect(
      parseHostMessage(envelope({ type: "run", gen: 1, files, assets }))
    ).toMatchObject({ assets });
  });

  // 表の値はそのまま img.src や fetch の宛先になる。スケッチの中で任意のコードを
  // 走らせる形 (javascript:) や、中身を送り込む形 (data:) を通さない。
  it.each([
    { "a.png": "javascript:alert(1)" },
    { "a.png": "data:text/html,<script>alert(1)</script>" },
    { "a.png": "blob:https://assets.example/1234" },
    { "a.png": "/a/abc/a.png" },
    { "a.png": 1 },
    { "../a.png": "https://assets.example/a/abc/a.png" },
    { "a/b.png": "https://assets.example/a/abc/b.png" },
    [["a.png", "https://assets.example/a/abc/a.png"]],
  ])("URL として受け付けられない表を持つ run を無視する (%j)", (assets) => {
    expect(
      parseHostMessage(envelope({ type: "run", gen: 1, files, assets }))
    ).toBeNull();
  });

  it("stop を読み取る", () => {
    expect(parseHostMessage(envelope({ type: "stop", gen: 0 }))).toEqual({
      type: "stop",
      gen: 0,
    });
  });

  it("封筒に入っていないメッセージを無視する", () => {
    expect(parseHostMessage({ type: "run", gen: 1, files })).toBeNull();
    expect(
      parseHostMessage({ channel: "other", message: { type: "stop", gen: 1 } })
    ).toBeNull();
  });

  it("封筒だけで中身が無いものを無視する", () => {
    expect(parseHostMessage({ channel: CHANNEL })).toBeNull();
    expect(parseHostMessage({ channel: CHANNEL, message: "stop" })).toBeNull();
  });

  it("未知の種別を無視する", () => {
    expect(parseHostMessage(envelope({ type: "eval", gen: 1 }))).toBeNull();
  });

  it("世代番号が非負整数でないものを無視する", () => {
    expect(parseHostMessage(envelope({ type: "stop", gen: -1 }))).toBeNull();
    expect(parseHostMessage(envelope({ type: "stop", gen: 1.5 }))).toBeNull();
    expect(parseHostMessage(envelope({ type: "stop", gen: "1" }))).toBeNull();
  });

  it("capture を読み取る", () => {
    expect(parseHostMessage(envelope({ type: "capture", gen: 7 }))).toEqual({
      type: "capture",
      gen: 7,
    });
  });

  it("ファイル構成が不正な run を無視する", () => {
    expect(parseHostMessage(envelope({ type: "run", gen: 1 }))).toBeNull();
    expect(
      parseHostMessage(
        envelope({ type: "run", gen: 1, files: { "a/b.js": "" } })
      )
    ).toBeNull();
  });
});

describe("parseRunnerMessage", () => {
  it("ready を読み取る", () => {
    expect(
      parseRunnerMessage(
        envelope({ type: "ready", protocolVersion: PROTOCOL_VERSION })
      )
    ).toEqual({ type: "ready", protocolVersion: PROTOCOL_VERSION });
  });

  it("rendered を読み取る", () => {
    expect(parseRunnerMessage(envelope({ type: "rendered", gen: 2 }))).toEqual({
      type: "rendered",
      gen: 2,
    });
  });

  it("console を読み取る", () => {
    expect(
      parseRunnerMessage(
        envelope({
          type: "console",
          level: "warn",
          message: "注意",
          timestamp: 1234,
        })
      )
    ).toEqual({
      type: "console",
      level: "warn",
      message: "注意",
      timestamp: 1234,
    });
  });

  it("未知の出力種別を無視する", () => {
    expect(
      parseRunnerMessage(
        envelope({
          type: "console",
          level: "fatal",
          message: "x",
          timestamp: 0,
        })
      )
    ).toBeNull();
  });

  it("console の欠けた項目を無視する", () => {
    expect(
      parseRunnerMessage(
        envelope({ type: "console", level: "log", message: "x" })
      )
    ).toBeNull();
    expect(
      parseRunnerMessage(
        envelope({ type: "console", level: "log", message: 1, timestamp: 0 })
      )
    ).toBeNull();
  });

  it("thumbnail の PNG を読み取る", () => {
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    expect(
      parseRunnerMessage(
        envelope({ type: "thumbnail", gen: 4, image, reason: null })
      )
    ).toEqual({ type: "thumbnail", gen: 4, image, reason: null });
  });

  it("撮れなかった知らせを理由ごと読み取る", () => {
    expect(
      parseRunnerMessage(
        envelope({
          type: "thumbnail",
          gen: 1,
          image: null,
          reason: "スケッチに canvas がありません",
        })
      )
    ).toEqual({
      type: "thumbnail",
      gen: 1,
      image: null,
      reason: "スケッチに canvas がありません",
    });
  });

  it("PNG でない中身は「撮れなかった」に倒す", () => {
    const parse = (image: unknown) =>
      parseRunnerMessage(
        envelope({ type: "thumbnail", gen: 1, image, reason: null })
      );

    // 受け取った Blob はそのまま保存の口へ送られるので、形式を確かめる。
    expect(parse(new Blob(["x"], { type: "image/svg+xml" }))).toMatchObject({
      image: null,
    });
    expect(parse("data:image/png;base64,xxxx")).toMatchObject({ image: null });
    expect(parse(new Blob([], { type: "image/png" }))).toMatchObject({
      image: null,
    });
  });

  it("上限を超える画像を捨てる", () => {
    const image = new Blob([new Uint8Array(MAX_THUMBNAIL_BYTES + 1)], {
      type: "image/png",
    });
    expect(
      parseRunnerMessage(
        envelope({ type: "thumbnail", gen: 1, image, reason: null })
      )
    ).toMatchObject({ image: null });
  });

  it("世代の無い thumbnail は無視する", () => {
    expect(
      parseRunnerMessage(
        envelope({ type: "thumbnail", image: null, reason: null })
      )
    ).toBeNull();
  });

  it("本体宛てのメッセージをランナー宛てとして読まない", () => {
    expect(
      parseRunnerMessage(envelope({ type: "run", gen: 1, files }))
    ).toBeNull();
  });
});

describe("isSupportedRunnerVersion", () => {
  it("最低版のランナーを受ける", () => {
    expect(isSupportedRunnerVersion(MIN_RUNNER_PROTOCOL_VERSION)).toBe(true);
  });

  it("本体より新しいランナーを受ける", () => {
    // デプロイはランナーが先に出る。ここで断ると、本体が追いつくまでの間
    // すべてのスケッチが動かなくなる (ADR 0007 の補足)。
    expect(isSupportedRunnerVersion(PROTOCOL_VERSION + 1)).toBe(true);
    expect(isSupportedRunnerVersion(PROTOCOL_VERSION + 99)).toBe(true);
  });

  it("古すぎるランナーを断る", () => {
    expect(isSupportedRunnerVersion(MIN_RUNNER_PROTOCOL_VERSION - 1)).toBe(
      false
    );
    expect(isSupportedRunnerVersion(0)).toBe(false);
  });

  it("整数でない版を断る", () => {
    expect(isSupportedRunnerVersion(2.5)).toBe(false);
    expect(isSupportedRunnerVersion(Number.NaN)).toBe(false);
    expect(isSupportedRunnerVersion(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
