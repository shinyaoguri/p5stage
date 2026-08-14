/**
 * 外部の Gist を作品として受け入れてよいかの判断 (Phase 2-6)。
 *
 * 受け入れた Gist は**そのまま正本になる**ので、断る側の判断がそのまま安全性に
 * なる。見るのは「誰のものか」「全部読めているか」「スケッチとして成り立つか」
 * 「アセットの一覧が読めるか」の 4 つと、受け入れたときに作品へ移す値
 * (タイトル・公開範囲・**所有を確かめる相手の sha256**)。
 */

import { describe, expect, it } from "vitest";

import {
  planGistAdoption,
  type AdoptionSource,
} from "../src/lib/sketches/gist-adopt";

const VIEWER_ID = 4242;
const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

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
      // アセットを使わない作品。台帳へ聞きに行く相手がいない。
      digests: [],
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

  it("読めない assets.json を持つ Gist は断る", () => {
    // 受け入れると、次の保存が必ず断られる作品ができる (保存経路は同じ検査を通す)。
    // 取り込む前なら、利用者は手元の Gist を直せる。
    const decision = planGistAdoption(
      source({
        files: { "index.html": "<!doctype html>", "assets.json": "{ 壊れた" },
      }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({
      kind: "reject",
      reason: "invalid_manifest",
    });
    expect(decision).toHaveProperty(
      "message",
      expect.stringContaining("assets.json")
    );
  });

  it("アセットとコードの名前がぶつかる Gist は断る", () => {
    // 実行時の名前解決は 1 つの表で引くので (3-3)、同じ名前が両方にあると
    // どちらが返るか決まらない。保存経路と同じ理由で断る。
    const decision = planGistAdoption(
      source({
        files: {
          "index.html": "<!doctype html>",
          "cat.png": "これはコード側のファイル",
          "assets.json": manifest({ "cat.png": DIGEST }),
        },
      }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({
      kind: "reject",
      reason: "invalid_manifest",
    });
  });

  it("受け入れるときは参照している実体を出す (所有の確認は台帳を持つ側)", () => {
    // ここは D1 に触らない純ロジック。「誰の所有を確かめればよいか」までを出し、
    // 引くのは呼び出し側 (ADR 0003 の 3-2 補足)。
    const decision = planGistAdoption(
      source({
        files: {
          "index.html": "<!doctype html>",
          "assets.json": manifest({
            "cat.png": DIGEST,
            "same.png": DIGEST,
            "cube.obj": OTHER_DIGEST,
          }),
        },
      }),
      VIEWER_ID
    );

    expect(decision).toMatchObject({ kind: "accept" });
    // 同じ実体を 2 つの名前で使っても、聞くのは 1 回でよい。
    expect(decision).toHaveProperty("digests", [DIGEST, OTHER_DIGEST]);
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
