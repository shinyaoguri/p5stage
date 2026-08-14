/**
 * アセットを持ち込む段取り (Phase 3-4)。
 *
 * 順序そのものが仕様になっている口なので、**呼んだ相手と回数**を見る。
 * 申告 (claim) を飛ばして送ると上限を超える転送が起き、既にある中身に送ると
 * 同じバイト列を二度運ぶ (ADR 0003 の dedup が効かない)。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAssetUsage,
  uploadAsset,
} from "../src/scripts/assets/asset-upload";

const SHA256 = "sha256-of-the-bytes";

const USAGE = { bytes: 100, quotaBytes: 1000, maxAssetBytes: 500 };

const ASSET = { sha256: SHA256, size: 3, mime: "image/png" as const };

interface Call {
  readonly url: string;
  readonly method: string;
}

/**
 * sha256 は結果を固定する。
 *
 * 中身から鍵が決まること自体は shared の単体テストが見ている。ここで確かめたいのは
 * 「その鍵をどの口へどの順で運ぶか」なので、値は動かない方が読みやすい。
 */
function stubDigest(): void {
  vi.stubGlobal("crypto", {
    subtle: {
      digest: () => Promise.resolve(new ArrayBuffer(0)),
    },
  });
}

/** 口ごとに応答を決める fetch。呼ばれた記録も残す。 */
function stubApi(handlers: {
  claim?: () => Response;
  put?: () => Response;
  list?: () => Response;
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method });

      if (url === "/api/assets" && method === "GET") {
        return Promise.resolve(
          handlers.list?.() ?? Response.json({ assets: [], usage: USAGE })
        );
      }
      if (url === "/api/assets") {
        return Promise.resolve(
          handlers.claim?.() ??
            Response.json({ status: "missing", usage: USAGE })
        );
      }
      return Promise.resolve(
        handlers.put?.() ??
          Response.json({ asset: ASSET, usage: USAGE }, { status: 201 })
      );
    })
  );
  return calls;
}

/** 3 バイトの「PNG」。中身の検査はサーバの仕事なので、ここでは中身を問わない。 */
function pngFile(name = "cat.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadAsset", () => {
  it("申告してから実体を送る", async () => {
    stubDigest();
    const calls = stubApi({});

    const result = await uploadAsset(pngFile());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual(ASSET);
    expect(result.usage).toEqual(USAGE);
    // 申告 → 実体の順。逆にすると上限を超える転送が起きる。
    expect(calls.map((call) => call.method)).toEqual(["POST", "PUT"]);
    expect(calls[1]?.url).toContain("/api/assets/");
  });

  it("既にある中身は転送しない (dedup)", async () => {
    stubDigest();
    const calls = stubApi({
      claim: () =>
        Response.json({ status: "stored", asset: ASSET, usage: USAGE }),
    });

    const result = await uploadAsset(pngFile());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deduped).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
  });

  it("申告で断られたら送らず、理由をそのまま伝える", async () => {
    stubDigest();
    const calls = stubApi({
      claim: () =>
        Response.json(
          { error: "too_large", message: "1 ファイルは 5MB までです" },
          { status: 413 }
        ),
    });

    const result = await uploadAsset(pngFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // サーバの文言をそのまま出す (同じ上限を 2 か所に書かない)。
    expect(result.message).toBe("1 ファイルは 5MB までです");
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
  });

  it("allowlist の外の形式は送る前に断る", async () => {
    stubDigest();
    const calls = stubApi({});

    const result = await uploadAsset(
      new File([new Uint8Array([1])], "evil.svg", { type: "image/svg+xml" })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("対応していない形式");
    expect(calls).toEqual([]);
  });

  it("形式はファイル名で決める (File.type は当てにしない)", async () => {
    stubDigest();
    const calls = stubApi({});

    // 端末によっては type が空で来る。それで「対応していない形式」に化けさせない。
    const result = await uploadAsset(
      new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "" })
    );

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["POST", "PUT"]);
  });

  it("空のファイルは送らない", async () => {
    stubDigest();
    const calls = stubApi({});

    const result = await uploadAsset(new File([], "cat.png"));

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("繋がらないときは接続を疑う文言にする", async () => {
    stubDigest();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );

    const result = await uploadAsset(pngFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("接続を確認");
  });
});

describe("fetchAssetUsage", () => {
  it("使用量を返す", async () => {
    stubApi({});

    expect(await fetchAssetUsage()).toEqual(USAGE);
  });

  it("未ログインは失敗ではなく null (エディタはログイン無しでも使える)", async () => {
    stubApi({
      list: () => Response.json({ error: "unauthorized" }, { status: 401 }),
    });

    expect(await fetchAssetUsage()).toBeNull();
  });
});
