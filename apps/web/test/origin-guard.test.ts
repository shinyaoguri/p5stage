/**
 * 状態を変える要求の出どころ検証 (ADR 0008)。
 *
 * 要になるのは **`Sec-Fetch-Site: same-site` を通さない**こと。実行オリジン
 * `preview.p5stage.org` は本体と same-site なので、ここを通すと他者コードから
 * cookie 付きの要求が成立してしまう。
 */

import { describe, expect, it } from "vitest";

import {
  forbiddenResponse,
  verifyRequestOrigin,
} from "../src/lib/http/origin-guard";

const WEB_ORIGIN = "https://p5stage.org";
const PREVIEW_ORIGIN = "https://preview.p5stage.org";

function request(headers: Record<string, string>): Request {
  return new Request(`${WEB_ORIGIN}/api/auth/logout`, {
    method: "POST",
    headers,
  });
}

describe("verifyRequestOrigin", () => {
  it("本体オリジンからの要求は通す", () => {
    const verdict = verifyRequestOrigin(
      request({ Origin: WEB_ORIGIN, "Sec-Fetch-Site": "same-origin" }),
      WEB_ORIGIN
    );
    expect(verdict.ok).toBe(true);
  });

  it("実行オリジン (same-site サブドメイン) からの要求は拒む", () => {
    // SameSite=Lax はこれを素通しする。だからここで止める。
    const verdict = verifyRequestOrigin(
      request({ Origin: PREVIEW_ORIGIN, "Sec-Fetch-Site": "same-site" }),
      WEB_ORIGIN
    );
    expect(verdict.ok).toBe(false);
  });

  it("Sec-Fetch-Site が same-site なら Origin が本体でも拒む", () => {
    const verdict = verifyRequestOrigin(
      request({ Origin: WEB_ORIGIN, "Sec-Fetch-Site": "same-site" }),
      WEB_ORIGIN
    );
    expect(verdict.ok).toBe(false);
  });

  it("まったくの別サイトからの要求は拒む", () => {
    const verdict = verifyRequestOrigin(
      request({
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      }),
      WEB_ORIGIN
    );
    expect(verdict.ok).toBe(false);
  });

  it("どちらのヘッダも無い要求は拒む", () => {
    const verdict = verifyRequestOrigin(request({}), WEB_ORIGIN);
    expect(verdict.ok).toBe(false);
  });

  it("Origin だけでも本体オリジンなら通す", () => {
    // Sec-Fetch-Site を送らないブラウザでも、正しい Origin があれば通す。
    const verdict = verifyRequestOrigin(
      request({ Origin: WEB_ORIGIN }),
      WEB_ORIGIN
    );
    expect(verdict.ok).toBe(true);
  });

  it("Sec-Fetch-Site だけでも same-origin なら通す", () => {
    const verdict = verifyRequestOrigin(
      request({ "Sec-Fetch-Site": "same-origin" }),
      WEB_ORIGIN
    );
    expect(verdict.ok).toBe(true);
  });

  it("拒んだ理由が分かる", () => {
    const verdict = verifyRequestOrigin(
      request({ "Sec-Fetch-Site": "same-site" }),
      WEB_ORIGIN
    );
    expect(verdict.ok ? "" : verdict.reason).toContain("same-site");
  });
});

describe("forbiddenResponse", () => {
  it("通った判定では応答を作らない", () => {
    expect(forbiddenResponse({ ok: true })).toBeNull();
  });

  it("拒んだ判定は 403 になる", () => {
    const response = forbiddenResponse({ ok: false, reason: "理由" });
    expect(response?.status).toBe(403);
  });
});
