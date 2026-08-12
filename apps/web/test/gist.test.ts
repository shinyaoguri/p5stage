/**
 * Gist API クライアント (Phase 2-3)。
 *
 * 見るのは 2 つ。**応答をどう読むか** (リビジョンが取れているか、取れなかった中身を
 * 空文字と取り違えていないか) と、**失敗をどう分けるか** (利用者の次の一手が
 * 「ログインし直す」「待つ」「直す」で変わるため)。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appAuth,
  authorizationValue,
  createGist,
  fetchGist,
  fetchGistForDelivery,
  GistError,
  parseGistContent,
  parseGistRevision,
  updateGist,
  userAuth,
} from "../src/lib/github/gist";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** GitHub の応答を 1 回分だけ差し替える。 */
function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const impl = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response)
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

function gistJson(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    id: "abc123",
    html_url: "https://gist.github.com/u/abc123",
    description: "波紋 — p5stage",
    history: [{ version: "cafe1234" }],
    files: { "sketch.js": { filename: "sketch.js", content: "// hi" } },
    ...overrides,
  });
}

describe("parseGistRevision", () => {
  it("history の先頭をリビジョンとして読む", () => {
    expect(
      parseGistRevision({
        id: "abc123",
        html_url: "https://gist.github.com/u/abc123",
        history: [{ version: "cafe1234" }, { version: "older" }],
      })
    ).toEqual({
      id: "abc123",
      url: "https://gist.github.com/u/abc123",
      revision: "cafe1234",
    });
  });

  it("リビジョンが読めなければ失敗にする", () => {
    // 後から辿れない保存は履歴として意味を持たないので、成功にしない。
    expect(() =>
      parseGistRevision({ id: "abc", html_url: "https://x", history: [] })
    ).toThrow(GistError);
    expect(() => parseGistRevision(null)).toThrow(GistError);
  });
});

describe("parseGistContent", () => {
  it("中身を取れなかったファイルは名前だけ返す", () => {
    // 空文字として扱うと、次の保存でその中身を消してしまう。
    const content = parseGistContent({
      id: "abc",
      html_url: "https://x",
      history: [{ version: "v1" }],
      files: {
        "big.csv": { truncated: true, content: "先頭だけ" },
        "sketch.js": { content: "// hi" },
        "gone.js": null,
      },
    });

    expect(content.files).toEqual({ "sketch.js": "// hi" });
    expect(content.truncated).toEqual(["big.csv"]);
  });

  it("持ち主と公開範囲を読む (取り込みの判断材料)", () => {
    const content = parseGistContent({
      id: "abc",
      html_url: "https://x",
      history: [{ version: "v1" }],
      files: { "sketch.js": { content: "// hi" } },
      owner: { id: 4242, login: "someone" },
      public: true,
    });

    expect(content.ownerId).toBe(4242);
    expect(content.isPublic).toBe(true);
  });

  it("持ち主が読めなければ null (自分のものに倒さない)", () => {
    // 匿名 Gist には owner が無い。ここを 0 や「自分」に倒すと、取り込みの
    // 所有者確認がすり抜ける。
    const content = parseGistContent({
      id: "abc",
      html_url: "https://x",
      history: [{ version: "v1" }],
      files: { "sketch.js": { content: "// hi" } },
    });

    expect(content.ownerId).toBeNull();
    // 公開の側へも倒さない (誤りが意図しない公開にならない向き)。
    expect(content.isPublic).toBe(false);
  });
});

describe("createGist", () => {
  it("公開範囲を指定して POST する", async () => {
    const fetchMock = stubFetch(gistJson());

    const revision = await createGist({
      token: "t",
      files: { "sketch.js": { content: "// hi" } },
      description: "波紋 — p5stage",
      isPublic: false,
    });

    expect(revision.revision).toBe("cafe1234");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/gists");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ public: false });
  });
});

describe("updateGist", () => {
  it("その Gist を PATCH する", async () => {
    const fetchMock = stubFetch(gistJson());

    await updateGist({
      token: "t",
      gistId: "abc123",
      files: { "old.js": null },
      description: "波紋 — p5stage",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/gists/abc123");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body)).files).toEqual({ "old.js": null });
  });
});

describe("失敗の分け方", () => {
  it("401 は auth", async () => {
    stubFetch(new Response("", { status: 401 }));

    await expect(fetchGist("t", "abc")).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("404 は not_found", async () => {
    stubFetch(new Response("", { status: 404 }));

    await expect(fetchGist("t", "abc")).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("残数 0 の 403 はレート制限 (認可の失敗と取り違えない)", async () => {
    stubFetch(
      new Response("", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      })
    );

    await expect(fetchGist("t", "abc")).rejects.toMatchObject({
      kind: "rate_limit",
    });
  });

  it("422 は rejected (送った内容の問題)", async () => {
    stubFetch(Response.json({ message: "Validation Failed" }, { status: 422 }));

    await expect(fetchGist("t", "abc")).rejects.toMatchObject({
      kind: "rejected",
      message: "Validation Failed",
    });
  });

  it("届かなければ network", async () => {
    stubFetch(new TypeError("failed to fetch"));

    await expect(fetchGist("t", "abc")).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("JSON でない 200 は api", async () => {
    stubFetch(new Response("<html>", { status: 200 }));

    await expect(fetchGist("t", "abc")).rejects.toMatchObject({ kind: "api" });
  });
});

describe("authorizationValue", () => {
  it("利用者のトークンは Bearer", () => {
    expect(authorizationValue(userAuth("gho_secret"))).toBe(
      "Bearer gho_secret"
    );
  });

  it("app の client credentials は Basic (匿名にしない)", () => {
    // 匿名は 60 回/時/IP で、Workers の出口 IP は多数の利用者と共有される。
    // 認証付きにすると 5,000 回/時/app になり、304 もレート制限を消費しなくなる。
    expect(authorizationValue(appAuth("Ov23li", "secret"))).toBe(
      `Basic ${btoa("Ov23li:secret")}`
    );
  });
});

describe("fetchGistForDelivery", () => {
  const auth = appAuth("Ov23li", "secret");

  it("ETag があれば条件付き GET にする", async () => {
    const impl = stubFetch(gistJson());

    await fetchGistForDelivery(auth, "abc", '"v1"');

    const init = impl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("If-None-Match")).toBe('"v1"');
  });

  it("ETag が無ければ条件を付けない", async () => {
    const impl = stubFetch(gistJson());

    await fetchGistForDelivery(auth, "abc", null);

    const init = impl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).has("If-None-Match")).toBe(false);
  });

  it("304 は unchanged (中身は来ない)", async () => {
    stubFetch(new Response(null, { status: 304 }));

    await expect(fetchGistForDelivery(auth, "abc", '"v1"')).resolves.toEqual({
      kind: "unchanged",
    });
  });

  it("変わっていれば中身と次の ETag を返す", async () => {
    stubFetch(
      Response.json(
        {
          id: "abc123",
          html_url: "https://gist.github.com/u/abc123",
          history: [{ version: "cafe1234" }],
          files: { "sketch.js": { filename: "sketch.js", content: "// hi" } },
        },
        { headers: { ETag: '"v2"' } }
      )
    );

    const result = await fetchGistForDelivery(auth, "abc", '"v1"');

    expect(result).toMatchObject({
      kind: "changed",
      etag: '"v2"',
      content: { revision: "cafe1234", files: { "sketch.js": "// hi" } },
    });
  });

  it("404 は not_found (作者が消した = tombstone の材料)", async () => {
    stubFetch(new Response("", { status: 404 }));

    await expect(fetchGistForDelivery(auth, "abc", null)).rejects.toMatchObject(
      { kind: "not_found" }
    );
  });

  it("届かなければ network", async () => {
    stubFetch(new TypeError("failed to fetch"));

    await expect(
      fetchGistForDelivery(auth, "abc", null)
    ).rejects.toBeInstanceOf(GistError);
  });
});
