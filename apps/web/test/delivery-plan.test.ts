/**
 * 閲覧配信の経路選択 (Phase 2-4)。
 *
 * ここが**「GitHub を叩くかどうか」を決める場所**なので、判断が緩むと
 * レート制限 (OAuth App あたり 5,000 回/時) が閲覧数に引きずられ始める。
 * 逆に固すぎると GitHub 側の削除・直接編集に永久に気付かない (ADR 0011)。
 */

import { describe, expect, it } from "vitest";

import {
  planDelivery,
  REVALIDATE_AFTER_MS,
} from "../src/lib/sketches/delivery-plan";
import type { Sketch } from "../src/lib/sketches/sketch";

const NOW = 1_800_000_000_000;

function sketch(overrides: Partial<Sketch> = {}): Sketch {
  return {
    id: "AbCdEfGhIjKlMnOp",
    ownerId: 1,
    gistId: "abc123",
    title: "波紋",
    description: "",
    visibility: "unlisted",
    createdAt: NOW,
    updatedAt: NOW,
    currentRevision: "cafe1234",
    revisionEtag: '"etag"',
    revisionCheckedAt: NOW,
    gistDeletedAt: null,
    deliveryBlockedAt: null,
    deliveryBlockedRevision: null,
    forkedFromSketchId: null,
    forkedFromRevision: null,
    thumbnailRevision: null,
    ...overrides,
  };
}

describe("planDelivery", () => {
  it("Gist が無い作品は未保存 (エラーではない)", () => {
    expect(planDelivery(sketch({ gistId: null }), NOW)).toEqual({
      kind: "unsaved",
    });
  });

  it("tombstone が立っていれば GitHub を叩かない", () => {
    // 消えたと分かっている Gist を閲覧のたびに叩き直すと、消費だけが増える。
    expect(planDelivery(sketch({ gistDeletedAt: NOW - 1 }), NOW)).toEqual({
      kind: "deleted",
    });
  });

  it("tombstone は写しが残っていても優先する", () => {
    expect(
      planDelivery(
        sketch({ gistDeletedAt: NOW - 1, currentRevision: "cafe1234" }),
        NOW
      )
    ).toEqual({ kind: "deleted" });
  });

  it("ポインタが無ければ GitHub から埋める", () => {
    expect(planDelivery(sketch({ currentRevision: null }), NOW)).toEqual({
      kind: "fill",
    });
  });

  it("確かめたばかりなら R2 から配るだけ (GitHub を叩かない)", () => {
    expect(planDelivery(sketch({ revisionCheckedAt: NOW }), NOW)).toEqual({
      kind: "serve",
      revision: "cafe1234",
      revalidate: false,
    });
  });

  it("間隔を過ぎたら配りつつ確かめ直す", () => {
    expect(
      planDelivery(
        sketch({ revisionCheckedAt: NOW - REVALIDATE_AFTER_MS }),
        NOW
      )
    ).toEqual({ kind: "serve", revision: "cafe1234", revalidate: true });
  });

  it("一度も確かめていなければ確かめ直す", () => {
    // 保存経路はポインタを進めるが ETag を持たない。一度も見ていない作品を
    // そのまま配り続けると、GitHub 側の削除にも編集にも気付けない。
    expect(planDelivery(sketch({ revisionCheckedAt: null }), NOW)).toEqual({
      kind: "serve",
      revision: "cafe1234",
      revalidate: true,
    });
  });
});
