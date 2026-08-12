/**
 * 外部の Gist を作品として受け入れてよいかの判断 (Phase 2-6)。
 *
 * 受け入れた Gist は**そのまま正本になる**ので、断る側の判断がそのまま安全性に
 * なる。見るのは「誰のものか」「全部読めているか」「スケッチとして成り立つか」の 3 つと、
 * 受け入れたときに作品へ移す値 (タイトル・公開範囲)。
 */

import { describe, expect, it } from "vitest";

import {
  planGistAdoption,
  type AdoptionSource,
} from "../src/lib/sketches/gist-adopt";

const VIEWER_ID = 4242;

function source(overrides: Partial<AdoptionSource> = {}): AdoptionSource {
  return {
    ownerId: VIEWER_ID,
    isPublic: false,
    description: "波紋 — p5stage",
    files: { "index.html": "<!doctype html>", "sketch.js": "// hi" },
    truncated: [],
    ...overrides,
  };
}

describe("planGistAdoption", () => {
  it("自分の Gist は受け入れる", () => {
    expect(planGistAdoption(source(), VIEWER_ID)).toEqual({
      kind: "accept",
      title: "波紋",
      visibility: "unlisted",
    });
  });

  it("他人の Gist は断る", () => {
    // 他人の Gist を正本にすると、書き込めないので保存できない作品ができる
    // (書けるのは本人のトークンだけ — 要件 5.2)。
    const decision = planGistAdoption(source({ ownerId: 9999 }), VIEWER_ID);

    expect(decision).toMatchObject({ kind: "reject", reason: "not_owner" });
  });

  it("持ち主の分からない Gist も断る", () => {
    // 匿名 Gist には owner が無い。読めないことを「自分のもの」に倒さない。
    const decision = planGistAdoption(source({ ownerId: null }), VIEWER_ID);

    expect(decision).toMatchObject({ kind: "reject", reason: "not_owner" });
  });

  it("中身を全部読めていない Gist は断る", () => {
    // 欠けた姿で写しを作ると、次の保存で読めなかったファイルだけが取り残される。
    const decision = planGistAdoption(
      source({ truncated: ["big.json"] }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({ kind: "reject", reason: "incomplete" });
    expect(decision).toHaveProperty(
      "message",
      expect.stringContaining("big.json")
    );
  });

  it("実行の起点が無い Gist は断る", () => {
    const decision = planGistAdoption(
      source({ files: { "sketch.js": "// hi" } }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({ kind: "reject", reason: "invalid_files" });
  });

  it("公開 Gist は公開の作品になる", () => {
    // 公開範囲は Gist の側で決まっていて、後から変えられない (ADR 0010)。
    expect(
      planGistAdoption(source({ isPublic: true }), VIEWER_ID)
    ).toMatchObject({ visibility: "public" });
  });

  it("p5stage 以外の description はそのまま作品名になる", () => {
    expect(
      planGistAdoption(source({ description: "my p5 sketch" }), VIEWER_ID)
    ).toMatchObject({ title: "my p5 sketch" });
  });

  it("description が空なら既定の名前を付ける", () => {
    expect(
      planGistAdoption(source({ description: "" }), VIEWER_ID)
    ).toMatchObject({ title: "無題のスケッチ" });
  });

  it("長すぎる description は切って作品名にする (断らない)", () => {
    const decision = planGistAdoption(
      source({ description: "あ".repeat(200) }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({ kind: "accept" });
    expect(decision).toHaveProperty("title", "あ".repeat(100));
  });
});
