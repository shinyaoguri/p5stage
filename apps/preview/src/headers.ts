/**
 * 実行 iframe を配信するオリジンのセキュリティヘッダ。
 *
 * このオリジンは他者のコードをそのまま実行する場所なので、本体サイトから隔離する
 * (docs/requirements.md 5.1)。本体と違い iframe への埋め込みが前提なので
 * `X-Frame-Options: DENY` は使えず、`frame-ancestors` で埋め込み元を絞る。
 */
export function buildSecurityHeaders(webOrigin: string): Headers {
  const headers = new Headers();
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  // 埋め込めるのは本体サイトだけ。他サイトからの hotlink 的な利用を防ぐ。
  headers.set("Content-Security-Policy", `frame-ancestors ${webOrigin}`);
  return headers;
}

/** 既存レスポンスのヘッダにセキュリティヘッダを重ねる。 */
export function withSecurityHeaders(
  response: Response,
  webOrigin: string
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of buildSecurityHeaders(webOrigin)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
