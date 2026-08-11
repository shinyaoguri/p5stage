import { describe, expect, it } from "vitest";

import {
  CHANNEL,
  PROTOCOL_VERSION,
  envelope,
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
      ).toEqual({ type: "run", gen: 1, files, transition: null });
    }
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

  it("本体宛てのメッセージをランナー宛てとして読まない", () => {
    expect(
      parseRunnerMessage(envelope({ type: "run", gen: 1, files }))
    ).toBeNull();
  });
});
