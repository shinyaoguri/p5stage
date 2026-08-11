import { resolveOrigins } from "@p5stage/shared";

import { withSecurityHeaders } from "./headers";
import { injectWebOrigin, isHtmlResponse } from "./inject-origin";

export default {
  async fetch(request, env): Promise<Response> {
    // 本体と別オリジンであることを実行時に確かめる。同一だと隔離が成立しない。
    const { web } = resolveOrigins({
      web: env.PUBLIC_WEB_ORIGIN,
      preview: new URL(request.url).origin,
    });

    const asset = await env.ASSETS.fetch(request);
    const response = withSecurityHeaders(asset, web);
    if (!isHtmlResponse(response)) return response;

    // ランナーが postMessage の相手を判別できるよう、本体オリジンを埋め込む。
    const html = injectWebOrigin(await response.text(), web);
    const headers = new Headers(response.headers);
    // 本文を差し替えたので、元の長さは意味を失う。
    headers.delete("Content-Length");
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
