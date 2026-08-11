import { resolveOrigins } from "@p5stage/shared";

import { withSecurityHeaders } from "./headers";

export default {
  async fetch(request, env): Promise<Response> {
    // 本体と別オリジンであることを実行時に確かめる。同一だと隔離が成立しない。
    const { web } = resolveOrigins({
      web: env.PUBLIC_WEB_ORIGIN,
      preview: new URL(request.url).origin,
    });

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, web);
  },
} satisfies ExportedHandler<Env>;
