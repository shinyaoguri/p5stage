/**
 * 読まなかった要求の本文を読み捨てる (#38)。
 *
 * **本文付きの要求に、本文を読まないまま応答を返すと `wrangler dev` が落ちる。**
 * 出どころの確認 (403)・ログインの確認 (401)・形式の確認 (415) はどれも本文を見る
 * 前に断るので、この形は API のあちこちで起きる。切る (`cancel`) のでは足りず、
 * **読み切る**必要がある (Phase 3-1 で 415 の直後に落ちたときに分かった)。
 *
 * 3-1 ではアップロードの口だけに置いていたが、middleware (ADR 0014) を通すように
 * したところ、同じ形が `POST /api/sketches/adopt` の 401 でも確実に踏まれるように
 * なった。**弾く口ごとに覚えて書く**形では次に足す口で必ず忘れるので、
 * 要求を 1 本残らず通る場所 (middleware) で最後に読み捨てる。
 */

/**
 * 読み捨てる量の上限。
 *
 * 捨てるために際限なく読む理由は無い。上限を超える分は読まずに切る
 * (そこまで読めば「本文を読まないまま返した」形は解消している)。
 */
const DRAIN_LIMIT_BYTES = 8 * 1024 * 1024;

/** 本文を読み切る。既に読まれている・本文が無いなら何もしない。 */
export async function drainRequestBody(request: Request): Promise<void> {
  if (request.bodyUsed || request.body === null) return;

  const reader = request.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > DRAIN_LIMIT_BYTES) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // 送り手が先に切っていることがある。捨てるのが目的なので、失敗しても構わない。
  }
}
