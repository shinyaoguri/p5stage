/**
 * GitHub の宛先の差し替え (Phase 2-7 / ADR 0013)。
 *
 * この値は「利用者のアクセストークンを添えて叩く先」なので、**受け入れの判定が
 * このテストの本体**。E2E のためにローカルへ向けられればよく、それ以外は
 * 何を渡されても本物の GitHub へ倒れることを固定する。
 */

import { describe, expect, it } from "vitest";

import {
  GITHUB_API_ORIGIN,
  GITHUB_WEB_ORIGIN,
  resolveGitHubOrigins,
} from "../src/lib/github/origins";

const DEFAULTS = { api: GITHUB_API_ORIGIN, web: GITHUB_WEB_ORIGIN };

describe("resolveGitHubOrigins", () => {
  it("差し替えが無ければ本物の GitHub (API と web は別ホスト)", () => {
    expect(resolveGitHubOrigins(undefined)).toEqual({
      api: "https://api.github.com",
      web: "https://github.com",
    });
  });

  it("空文字・null も差し替え無しとして扱う", () => {
    expect(resolveGitHubOrigins("")).toEqual(DEFAULTS);
    expect(resolveGitHubOrigins(null)).toEqual(DEFAULTS);
  });

  it("ループバックなら受け入れ、API と web の両方を差し替える", () => {
    // テストダブルは 1 つのサーバで両方を受ける (パスが重ならない)。
    expect(resolveGitHubOrigins("http://localhost:8792")).toEqual({
      api: "http://localhost:8792",
      web: "http://localhost:8792",
    });
    expect(resolveGitHubOrigins("http://127.0.0.1:8792")).toEqual({
      api: "http://127.0.0.1:8792",
      web: "http://127.0.0.1:8792",
    });
    expect(resolveGitHubOrigins("http://[::1]:8792")).toEqual({
      api: "http://[::1]:8792",
      web: "http://[::1]:8792",
    });
  });

  it("外向きのホストは受け入れない", () => {
    // ここが緩むと、env を 1 つ書き換えるだけで利用者のトークンが他所へ流れる。
    expect(resolveGitHubOrigins("https://evil.example.com")).toEqual(DEFAULTS);
    expect(
      resolveGitHubOrigins("https://api.github.com.evil.example.com")
    ).toEqual(DEFAULTS);
  });

  it("ホスト名に localhost を含むだけの宛先も受け入れない", () => {
    // 前方・後方一致で見ていると通ってしまう形。完全一致で判定する。
    expect(resolveGitHubOrigins("https://localhost.evil.example.com")).toEqual(
      DEFAULTS
    );
    expect(resolveGitHubOrigins("https://notlocalhost")).toEqual(DEFAULTS);
  });

  it("http / https 以外は受け入れない", () => {
    expect(resolveGitHubOrigins("file://localhost/etc/passwd")).toEqual(
      DEFAULTS
    );
    expect(resolveGitHubOrigins("ws://localhost:8792")).toEqual(DEFAULTS);
  });

  it("URL として読めなければ既定へ倒す", () => {
    expect(resolveGitHubOrigins("localhost:8792")).toEqual(DEFAULTS);
    expect(resolveGitHubOrigins("　")).toEqual(DEFAULTS);
  });

  it("パスやクエリは持ち込ませない", () => {
    // 宛先の組み立ては絶対パスで行うので、ここでパスを残しても効かない。
    // 残ったまま渡ると「効いていないのに指定できたように見える」ので落とす。
    expect(resolveGitHubOrigins("http://localhost:8792/gh?x=1")).toEqual({
      api: "http://localhost:8792",
      web: "http://localhost:8792",
    });
  });
});
