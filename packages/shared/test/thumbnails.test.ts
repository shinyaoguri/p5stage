import { describe, expect, it } from "vitest";

import {
  MAX_THUMBNAIL_EDGE,
  thumbnailPath,
  thumbnailSize,
} from "../src/thumbnails";

describe("thumbnailSize", () => {
  it("上限より小さい絵はそのまま (拡大しない)", () => {
    expect(thumbnailSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it("横長は幅を上限に合わせ、縦横比を保つ", () => {
    expect(thumbnailSize(2400, 1200)).toEqual({
      width: MAX_THUMBNAIL_EDGE,
      height: MAX_THUMBNAIL_EDGE / 2,
    });
  });

  it("縦長は高さを上限に合わせる", () => {
    expect(thumbnailSize(1200, 2400)).toEqual({
      width: MAX_THUMBNAIL_EDGE / 2,
      height: MAX_THUMBNAIL_EDGE,
    });
  });

  it("正方形は両辺が上限になる", () => {
    expect(thumbnailSize(3000, 3000)).toEqual({
      width: MAX_THUMBNAIL_EDGE,
      height: MAX_THUMBNAIL_EDGE,
    });
  });

  it("極端に細長い絵でも 1px は残す (canvas を作れなくなるため)", () => {
    expect(thumbnailSize(100000, 10)).toEqual({
      width: MAX_THUMBNAIL_EDGE,
      height: 1,
    });
  });

  it("描けない大きさは撮れないものとして扱う", () => {
    expect(thumbnailSize(0, 100)).toBeNull();
    expect(thumbnailSize(100, -1)).toBeNull();
    expect(thumbnailSize(Number.NaN, 100)).toBeNull();
    expect(thumbnailSize(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });
});

describe("thumbnailPath", () => {
  it("鍵は (gist, リビジョン) の組", () => {
    expect(thumbnailPath("abc123", "def456")).toBe("/t/abc123/def456.png");
  });
});
