import { OriginConfigError, resolveOrigins } from "@p5stage/shared";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

import { configuredAssetsOrigin } from "../../lib/assets/delivery-origin";

export const prerender = false;

/**
 * 疎通確認用。静的アセットではなく Worker 側が動いていることと、
 * オリジン構成 (本体 / 実行 iframe / アセット — 要件 5.1 / ADR 0014) が
 * 妥当かをまとめて返す。
 */
export const GET: APIRoute = ({ url }) => {
  try {
    const origins = resolveOrigins({
      web: url.origin,
      preview: env.PUBLIC_PREVIEW_ORIGIN,
      assets: configuredAssetsOrigin(),
    });
    return Response.json({ status: "ok", origins });
  } catch (error) {
    if (error instanceof OriginConfigError) {
      return Response.json(
        { status: "misconfigured", error: error.message },
        { status: 500 }
      );
    }
    throw error;
  }
};
