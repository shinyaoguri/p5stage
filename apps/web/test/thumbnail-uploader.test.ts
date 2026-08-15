/**
 * 保存できた版の絵を撮って上げる側 (Phase 4-4)。
 *
 * ここが守るのは「撮れなかったときに何もしない」ことと、「同じ版を二度上げない」こと。
 * 撮影は失敗が普通にあるので、**失敗しても次の保存で撮り直せる**状態が要る。
 */

import { describe, expect, it, vi } from "vitest";

import { ThumbnailUploader } from "../src/scripts/sketch/thumbnail-uploader";

const SKETCH_ID = "sketch-1";
const REVISION = "c".repeat(40);

function png(size = 32): Blob {
  return new Blob([new Uint8Array(size)], { type: "image/png" });
}

function ok(): Response {
  return new Response(null, { status: 201 });
}

describe("ThumbnailUploader", () => {
  it("撮れた絵をその版の口へ送る", async () => {
    const send = vi.fn(async () => ok());
    const uploader = new ThumbnailUploader({
      capture: async () => png(),
      send: send as unknown as typeof fetch,
    });

    await uploader.onSaved(SKETCH_ID, REVISION);

    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sketches/${SKETCH_ID}/thumbnail?rev=${REVISION}`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("image/png");
  });

  it("撮れなければ何も送らない", async () => {
    const send = vi.fn(async () => ok());
    const uploader = new ThumbnailUploader({
      capture: async () => null,
      send: send as unknown as typeof fetch,
    });

    await uploader.onSaved(SKETCH_ID, REVISION);

    expect(send).not.toHaveBeenCalled();
  });

  it("上げ終わった版は二度送らない (中身は変わらない)", async () => {
    const send = vi.fn(async () => ok());
    const uploader = new ThumbnailUploader({
      capture: async () => png(),
      send: send as unknown as typeof fetch,
    });

    await uploader.onSaved(SKETCH_ID, REVISION);
    await uploader.onSaved(SKETCH_ID, REVISION);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("版が進めば撮り直して送る", async () => {
    const send = vi.fn(async () => ok());
    const uploader = new ThumbnailUploader({
      capture: async () => png(),
      send: send as unknown as typeof fetch,
    });

    await uploader.onSaved(SKETCH_ID, REVISION);
    await uploader.onSaved(SKETCH_ID, "d".repeat(40));

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("断られた版は次の保存でやり直す", async () => {
    const send = vi.fn(async () => new Response(null, { status: 409 }));
    const uploader = new ThumbnailUploader({
      capture: async () => png(),
      send: send as unknown as typeof fetch,
    });

    await uploader.onSaved(SKETCH_ID, REVISION);
    await uploader.onSaved(SKETCH_ID, REVISION);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("送信が落ちても投げない (編集を止めない)", async () => {
    const uploader = new ThumbnailUploader({
      capture: async () => png(),
      send: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });

    await expect(
      uploader.onSaved(SKETCH_ID, REVISION)
    ).resolves.toBeUndefined();
  });

  it("上限を超える絵は送らない", async () => {
    const send = vi.fn(async () => ok());
    const uploader = new ThumbnailUploader({
      capture: async () => png(512 * 1024 + 1),
      send: send as unknown as typeof fetch,
    });

    await uploader.onSaved(SKETCH_ID, REVISION);

    expect(send).not.toHaveBeenCalled();
  });

  it("撮影中に来た次の保存を重ねて走らせない", async () => {
    const send = vi.fn(async () => ok());
    let release: () => void = () => {};
    const uploader = new ThumbnailUploader({
      capture: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return png();
      },
      send: send as unknown as typeof fetch,
    });

    const first = uploader.onSaved(SKETCH_ID, REVISION);
    await uploader.onSaved(SKETCH_ID, "d".repeat(40));
    release();
    await first;

    expect(send).toHaveBeenCalledTimes(1);
  });
});
