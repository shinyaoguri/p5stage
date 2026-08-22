/**
 * 一覧のカードの組み立て (Phase 5)。
 *
 * ここで見るのは**絵を当てられないときに黙って諦められるか**。トップページも
 * 作者のページも、サムネイルが無いだけで一覧ごと欠けてはいけない。
 */

import { describe, expect, it } from "vitest";

import { toSketchCards } from "../src/lib/sketches/card";
import type { SketchWithOwner } from "../src/lib/sketches/sketch";

const NOW = 1_800_000_000_000;
const REVISION = "c0ffee1234567890abcdef1234567890abcdef12";
const ORIGIN = "https://assets.example";

function sketch(overrides: Partial<SketchWithOwner> = {}): SketchWithOwner {
  return {
    id: "AbCdEfGhIjKlMnOp",
    ownerId: 1,
    gistId: "abc123",
    title: "波紋",
    description: "",
    visibility: "public",
    createdAt: NOW,
    updatedAt: NOW,
    currentRevision: REVISION,
    revisionEtag: '"etag"',
    revisionCheckedAt: NOW,
    gistDeletedAt: null,
    deliveryBlockedAt: null,
    deliveryBlockedRevision: null,
    forkedFromSketchId: null,
    forkedFromRevision: null,
    thumbnailRevision: REVISION,
    ownerLogin: "shinyaoguri",
    ownerAvatarUrl: null,
    ...overrides,
  };
}

describe("toSketchCards", () => {
  it("作品ページへのリンクとサムネイルの絶対 URL を組む", () => {
    const [card] = toSketchCards([sketch()], ORIGIN);

    expect(card).toMatchObject({
      href: "/@shinyaoguri/AbCdEfGhIjKlMnOp",
      title: "波紋",
      ownerLogin: "shinyaoguri",
      updatedAt: NOW,
    });
    // `/t/` は配信ホストからしか出ない (ADR 0014) ので、相対 URL では届かない。
    expect(card?.thumbnailUrl).toBe(`${ORIGIN}/t/abc123/${REVISION}.png`);
  });

  it("撮れていない作品は絵を諦める", () => {
    const [card] = toSketchCards([sketch({ thumbnailRevision: null })], ORIGIN);

    expect(card?.thumbnailUrl).toBeNull();
  });

  it("Gist から切り離された作品は絵を諦める", () => {
    // R2 のキーは gist_id を含む。切り離しは thumbnail_revision も NULL へ戻すが、
    // 片方だけ残っていても壊れた URL を組まない。
    const [card] = toSketchCards([sketch({ gistId: null })], ORIGIN);

    expect(card?.thumbnailUrl).toBeNull();
  });

  it("配信オリジンが未設定でも一覧は成立する", () => {
    const [card] = toSketchCards([sketch()], null);

    expect(card?.href).toBe("/@shinyaoguri/AbCdEfGhIjKlMnOp");
    expect(card?.thumbnailUrl).toBeNull();
  });
});
