/**
 * 作品ページが `?rev=` をどう扱うかの判断 (Phase 4-1 / ADR 0016)。
 *
 * ここが緩むと、**過去の版のふりをして最新が配られる**か、当てずっぽうの版を
 * 並べた要求が D1 と R2 に流れ込む。逆に固すぎると、切り離しや削除の後に
 * 開けるはずの無い版が開き続ける。
 */

import { describe, expect, it } from "vitest";

import {
  isRevisionSha,
  listableGistId,
  planRevisionView,
} from "../src/lib/sketches/revision-view";
import type { Sketch } from "../src/lib/sketches/sketch";

const NOW = 1_800_000_000_000;
const CURRENT = "c0ffee1234567890abcdef1234567890abcdef12";
const PAST = "0123456789abcdef0123456789abcdef01234567";

function sketch(overrides: Partial<Sketch> = {}): Sketch {
  return {
    id: "AbCdEfGhIjKlMnOp",
    ownerId: 1,
    gistId: "abc123",
    title: "波紋",
    description: "",
    visibility: "public",
    createdAt: NOW,
    updatedAt: NOW,
    currentRevision: CURRENT,
    revisionEtag: '"etag"',
    revisionCheckedAt: NOW,
    gistDeletedAt: null,
    ...overrides,
  };
}

describe("isRevisionSha", () => {
  it("16 進の並びを受け付ける", () => {
    expect(isRevisionSha(PAST)).toBe(true);
    expect(isRevisionSha("0123456")).toBe(true);
  });

  it("16 進でないもの・短すぎるものを断る", () => {
    expect(isRevisionSha("e2erev01")).toBe(false);
    expect(isRevisionSha("012345")).toBe(false);
    expect(isRevisionSha("C0FFEE1234567890")).toBe(false);
    expect(isRevisionSha("")).toBe(false);
  });

  it("キーに混ぜられる形を断る", () => {
    // R2 のキーは文字列連結で作る。区切りを含む値をそのまま通さない。
    expect(isRevisionSha("../../other")).toBe(false);
    expect(isRevisionSha("cafe/1234")).toBe(false);
  });
});

describe("planRevisionView", () => {
  it("指定が無ければ今の版", () => {
    expect(planRevisionView(sketch(), null)).toEqual({ kind: "current" });
  });

  it("今の版を指す指定は正典 URL へ寄せる", () => {
    // 同じ中身に 2 つの URL があると、キャッシュも検索結果も割れる。
    expect(planRevisionView(sketch(), CURRENT)).toEqual({ kind: "canonical" });
  });

  it("過去の版は Gist ごと返す", () => {
    expect(planRevisionView(sketch(), PAST)).toEqual({
      kind: "past",
      revision: PAST,
      gistId: "abc123",
    });
  });

  it("形が違う指定は 404 に倒す", () => {
    expect(planRevisionView(sketch(), "not-a-sha")).toEqual({
      kind: "unknown",
    });
  });

  it("切り離した作品では過去の版も開かない", () => {
    // 写しは R2 に残っているが、この作品のものとして配る根拠はもう無い
    // (ADR 0012 の「切り離しは閲覧者から見て何かが変わる」)。
    expect(
      planRevisionView(sketch({ gistId: null, currentRevision: null }), PAST)
    ).toEqual({ kind: "unknown" });
  });

  it("作者が Gist を消した作品では過去の版も開かない", () => {
    expect(planRevisionView(sketch({ gistDeletedAt: NOW - 1 }), PAST)).toEqual({
      kind: "unknown",
    });
  });
});

describe("listableGistId", () => {
  it("普通の作品は履歴を引ける", () => {
    expect(listableGistId(sketch())).toBe("abc123");
  });

  it("切り離した作品と消えた作品では引かない", () => {
    // 開けない版を並べないのが履歴の約束 (ADR 0016)。
    expect(listableGistId(sketch({ gistId: null }))).toBeNull();
    expect(listableGistId(sketch({ gistDeletedAt: NOW - 1 }))).toBeNull();
  });
});
