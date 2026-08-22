/**
 * サムネイルを受け付けてよいかの判断 (Phase 4-4 / ADR 0019)。
 *
 * 見るのは 3 つ — **持ち主か**、**配信中の版か**、**PNG と名乗っているか**。
 * 版を確かめるのは、保存と撮影の間に別のタブがもう一度保存していることがあるため。
 */

import { describe, expect, it } from "vitest";

import type { Sketch } from "../src/lib/sketches/sketch";
import {
  isThumbnailRejection,
  planThumbnailUpload,
  thumbnailKey,
} from "../src/lib/sketches/thumbnail";

const OWNER_ID = 4242;
const OTHER_ID = 424242;
const GIST_ID = "b".repeat(32);
const REVISION = "c".repeat(40);

function sketch(overrides: Partial<Sketch> = {}): Sketch {
  return {
    id: "sketch-1",
    ownerId: OWNER_ID,
    gistId: GIST_ID,
    title: "作品",
    description: "",
    visibility: "public",
    createdAt: 0,
    updatedAt: 0,
    currentRevision: REVISION,
    revisionEtag: null,
    revisionCheckedAt: null,
    gistDeletedAt: null,
    deliveryBlockedAt: null,
    deliveryBlockedRevision: null,
    forkedFromSketchId: null,
    forkedFromRevision: null,
    thumbnailRevision: null,
    ...overrides,
  };
}

describe("planThumbnailUpload", () => {
  it("持ち主が配信中の版に PNG を置ける", () => {
    const plan = planThumbnailUpload(sketch(), OWNER_ID, REVISION, "image/png");
    expect(plan).toEqual({ gistId: GIST_ID, revision: REVISION });
  });

  it("`charset` などが付いた Content-Type も受ける", () => {
    expect(
      planThumbnailUpload(sketch(), OWNER_ID, REVISION, "image/PNG; charset=x")
    ).toEqual({ gistId: GIST_ID, revision: REVISION });
  });

  it("他人の作品には置けない (存在も漏らさない)", () => {
    const plan = planThumbnailUpload(sketch(), OTHER_ID, REVISION, "image/png");
    expect(isThumbnailRejection(plan) && plan.status).toBe(404);
  });

  it("まだ保存されていない作品には置けない", () => {
    const plan = planThumbnailUpload(
      sketch({ gistId: null, currentRevision: null }),
      OWNER_ID,
      REVISION,
      "image/png"
    );
    expect(isThumbnailRejection(plan) && plan.code).toBe("unsaved");
  });

  it("配信中でない版は断る (撮った絵と作品がずれる)", () => {
    const plan = planThumbnailUpload(
      sketch(),
      OWNER_ID,
      "d".repeat(40),
      "image/png"
    );
    expect(isThumbnailRejection(plan) && plan.code).toBe("stale_revision");
  });

  it("版の指定が無ければ断る", () => {
    const plan = planThumbnailUpload(sketch(), OWNER_ID, null, "image/png");
    expect(isThumbnailRejection(plan) && plan.code).toBe("stale_revision");
  });

  it("PNG 以外は受けない", () => {
    for (const type of ["image/svg+xml", "text/html", null]) {
      const plan = planThumbnailUpload(sketch(), OWNER_ID, REVISION, type);
      expect(isThumbnailRejection(plan) && plan.status).toBe(415);
    }
  });
});

describe("thumbnailKey", () => {
  it("リビジョンの写しと同じ単位で、混ざらない前置きを持つ", () => {
    expect(thumbnailKey(GIST_ID, REVISION)).toBe(
      `thumbs/${GIST_ID}/${REVISION}.png`
    );
  });
});
