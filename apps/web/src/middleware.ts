/**
 * 読まれなかった要求の本文を、応答の後に捨てる (#38)。
 *
 * `wrangler dev` の Worker が、**本文を読まないまま捨てた要求のあとに落ちる**。
 * 中身の無い `✘ [ERROR]` を出してプロセスごと終わり、以降の E2E は接続拒否になる。
 * 落ちる直前は必ず「読む前に 401 / 403 を返す口」で、ステータスは 403 に限らない。
 *
 * 守りは本文より先に効かせるのが正しい (出どころもログインも、中身を読む理由が無い)。
 * そこは変えずに、**応答を作った後で読み残しを片付ける**形にする。
 *
 * ここに置くのは、口ごとに書くと 1 つ書き忘れた時点で穴になるため。API が増えても
 * 通り道は変わらないので、この 1 か所で全部を賄える。
 */

import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

  const body = context.request.body;
  if (body !== null && !context.request.bodyUsed) {
    try {
      await body.cancel();
    } catch {
      // 既に切れている。読み残しが無くなっていれば目的は果たされている。
    }
  }

  return response;
});
