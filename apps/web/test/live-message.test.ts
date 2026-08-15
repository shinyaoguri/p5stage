/**
 * 同期配信のメッセージ (Phase 4-2)。
 *
 * 受けた値は**そのまま次の要求の URL に入る** (`/api/sketches/:id/revisions/:rev`)。
 * 送り主は自分たちのサーバだが、境界の作法どおり形を確かめる — ここが緩むと、
 * 通知を装って任意のパスを組ませる口になる。
 */

import { describe, expect, it } from "vitest";

import {
  LIVE_PONG,
  parseLiveMessage,
  revisionNotice,
} from "../src/lib/live/message";

const REVISION = "e2e1111111111111111111111111111111111111";

describe("parseLiveMessage", () => {
  it("配った形をそのまま読み取れる", () => {
    expect(parseLiveMessage(revisionNotice(REVISION))).toEqual({
      type: "revision",
      revision: REVISION,
    });
  });

  it("生存確認の応答は通知ではない", () => {
    // `setWebSocketAutoResponse` が返す pong も同じ口に届く。
    expect(parseLiveMessage(LIVE_PONG)).toBeNull();
  });

  it("文字列でない受信は捨てる", () => {
    // WebSocket は ArrayBuffer も運ぶ。
    expect(parseLiveMessage(new ArrayBuffer(8))).toBeNull();
    expect(parseLiveMessage(null)).toBeNull();
    expect(
      parseLiveMessage({ type: "revision", revision: REVISION })
    ).toBeNull();
  });

  it("JSON として読めない受信は捨てる", () => {
    expect(parseLiveMessage("{")).toBeNull();
    expect(parseLiveMessage("")).toBeNull();
  });

  it("知らない種別は捨てる", () => {
    expect(
      parseLiveMessage(JSON.stringify({ type: "run", revision: REVISION }))
    ).toBeNull();
    expect(parseLiveMessage(JSON.stringify({ revision: REVISION }))).toBeNull();
  });

  it("リビジョンの形が違えば捨てる", () => {
    // ここを通すと `revisions/<なんでも>` を組ませることになる。
    for (const revision of [
      "../../secret",
      "e2e111",
      "E2E1111111111111111111111111111111111111",
      "",
      42,
      null,
    ]) {
      expect(
        parseLiveMessage(JSON.stringify({ type: "revision", revision }))
      ).toBeNull();
    }
  });
});
