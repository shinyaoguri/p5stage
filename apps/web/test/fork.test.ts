/**
 * フォークしてよいか、どの経路で作るかの判断 (Phase 4-3)。
 *
 * ここが決めるのは 2 つ。**GitHub 側で何をするか** (自分の Gist は fork できないので
 * 経路が分かれる) と、**そのまま複製してよい中身か**。中身の判断は取り込み (2-6) と
 * 同じ規則で、理由も同じ — 欠けたまま受け入れると、フォーク先の次の保存で
 * そのファイルが消える。
 */

import { describe, expect, it } from "vitest";

import { planSketchFork, type ForkSource } from "../src/lib/sketches/fork";

const VIEWER_ID = 4242;
const AUTHOR_ID = 424242;
const DIGEST = "a".repeat(64);

/** アセット 1 件を持つ assets.json。 */
function manifest(entries: Record<string, string>): string {
  return JSON.stringify({
    version: 1,
    assets: Object.fromEntries(
      Object.entries(entries).map(([name, sha256]) => [
        name,
        { sha256, size: 70, mime: "image/png" },
      ])
    ),
  });
}

function source(overrides: Partial<ForkSource> = {}): ForkSource {
  return {
    ownerId: AUTHOR_ID,
    files: {
      "index.html": "<!doctype html>",
      "sketch.js": "// hi",
    },
    truncated: [],
    ...overrides,
  };
}

describe("planSketchFork", () => {
  it("他人の Gist は fork API の経路になる", () => {
    const decision = planSketchFork(source(), VIEWER_ID);

    expect(decision).toMatchObject({ kind: "accept", route: "fork" });
  });

  it("自分の Gist は fork できないので複製の経路になる", () => {
    const decision = planSketchFork(source({ ownerId: VIEWER_ID }), VIEWER_ID);

    expect(decision).toMatchObject({ kind: "accept", route: "copy" });
  });

  it("持ち主が読めない Gist は自分のものに倒さない", () => {
    // 匿名 Gist には owner が無い。「自分ではない」= fork 経路へ倒す
    // (逆に倒すと、fork できるものを新規作成に回すことになる)。
    const decision = planSketchFork(source({ ownerId: null }), VIEWER_ID);

    expect(decision).toMatchObject({ kind: "accept", route: "fork" });
  });

  it("中身を全部読めていない Gist は断る", () => {
    const decision = planSketchFork(
      source({ truncated: ["big.txt"] }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({ kind: "reject", reason: "incomplete" });
    if (decision.kind === "reject") {
      // どのファイルが読めなかったかまで見せる (直す手がかりになる)。
      expect(decision.message).toContain("big.txt");
    }
  });

  it("スケッチとして成り立たない構成は断る", () => {
    const decision = planSketchFork(
      source({ files: { "sketch.js": "// hi" } }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({ kind: "reject", reason: "invalid_files" });
  });

  it("読めない assets.json は断る", () => {
    const decision = planSketchFork(
      source({
        files: {
          "index.html": "<!doctype html>",
          "sketch.js": "// hi",
          "assets.json": "{ 壊れている",
        },
      }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({
      kind: "reject",
      reason: "invalid_manifest",
    });
  });

  it("参照している実体を、所有を確かめる相手として出す", () => {
    const decision = planSketchFork(
      source({
        files: {
          "index.html": "<!doctype html>",
          "sketch.js": "// hi",
          "assets.json": manifest({ "cat.png": DIGEST }),
        },
      }),
      VIEWER_ID
    );

    // ここは D1 に触らないので、計上できるかの判断は呼び出し側に渡す。
    expect(decision).toMatchObject({ kind: "accept", digests: [DIGEST] });
  });

  it("アセットを使っていない作品の digests は空", () => {
    const decision = planSketchFork(source(), VIEWER_ID);

    expect(decision).toMatchObject({ kind: "accept", digests: [] });
  });
});
