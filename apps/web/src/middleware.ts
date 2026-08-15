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

import { ASSET_ROUTE_PREFIX, THUMBNAIL_ROUTE_PREFIX } from "@p5stage/shared";
import { defineMiddleware } from "astro:middleware";

import { isAssetsHost } from "./lib/assets/delivery-origin";
import { drainRequestBody } from "./lib/http/body";

/**
 * 配信ホストから出すもの。
 *
 * アセットの実体 (3-3) と、実行結果のサムネイル (4-4)。どちらも**利用者の
 * ブラウザから来たバイト列**で、本体のオリジンから配らない理由が同じ。
 */
const DELIVERY_PREFIXES = [ASSET_ROUTE_PREFIX, THUMBNAIL_ROUTE_PREFIX];

export const onRequest = defineMiddleware(async (context, next) => {
  const onAssetsHost = isAssetsHost(context.url);
  const wantsAsset = DELIVERY_PREFIXES.some((prefix) =>
    context.url.pathname.startsWith(prefix)
  );

  // 配信ホストでは配信するものだけ、本体ではそれ以外だけ。
  // 「無い」とだけ答える (どちらのホストに何があるかを説明しない)。
  const response =
    onAssetsHost === wantsAsset
      ? await next()
      : new Response(null, { status: 404 });

  // 応答を作った後に、誰も読まなかった本文を読み捨てる (#38)。
  // 弾く口は本文を見る前に断るので、この形はここを通る要求のあちこちで起きる。
  await drainRequestBody(context.request);

  return response;
});
