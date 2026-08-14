/**
 * ホスト名で「どの顔で応じるか」を分ける (ADR 0014)。
 *
 * 本体 (p5stage.org) とアセット配信 (assets.p5stage.org) は同じ Worker だが、
 * ブラウザから見れば別オリジンで、置いているものの性質も違う — 本体は自分たちの
 * 画面と API、配信は**他者がアップロードした中身**。
 *
 * どちらのホストでも両方が出てしまうと、オリジンを分けた意味が半分無くなる
 * (本体のホストから他者のアセットが配られ、配信のホストでログインの口が開く)。
 * 混ざらないことをここで固定する。
 *
 * セッション cookie は `__Host-` なので配信ホストには届かない (ADR 0008)。
 * つまりこの振り分けが漏れても認証情報は渡らないが、**漏れないことを
 * コードで示せる**ようにこの層を置く。
 */

import { ASSET_ROUTE_PREFIX } from "@p5stage/shared";
import { defineMiddleware } from "astro:middleware";

import { isAssetsHost } from "./lib/assets/delivery-origin";

export const onRequest = defineMiddleware((context, next) => {
  const onAssetsHost = isAssetsHost(context.url);
  const wantsAsset = context.url.pathname.startsWith(ASSET_ROUTE_PREFIX);

  // 配信ホストではアセットだけ、本体ではアセット以外だけ。
  // 「無い」とだけ答える (どちらのホストに何があるかを説明しない)。
  if (onAssetsHost !== wantsAsset) {
    return new Response(null, { status: 404 });
  }

  return next();
});
