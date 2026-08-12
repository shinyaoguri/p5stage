/**
 * 状態を変える要求が本体オリジンから来たかを確かめる (ADR 0008)。
 *
 * 実行環境が same-site サブドメインにあるため、`SameSite=Lax` は CSRF 防御として数えられない
 * (`preview.p5stage.org` 上で動く他者コードが本体へ送る要求は same-site 扱いになり、
 * cookie が付いてしまう)。そこで**要求元を明示的に検証する**。
 *
 * 見るのは 2 つで、どちらか片方でも「本体オリジン以外」と言っていれば拒否する。
 *
 * - `Origin`: クロスオリジンの書き込み要求には必ず付く
 * - `Sec-Fetch-Site`: 送信元との関係。`same-site` は**サブドメインを含む**ので通さない。
 *   通すのは `same-origin` だけ
 *
 * どちらも無い要求 (古いブラウザ・curl・拡張) は通さない。ブラウザから普通に呼ばれる限り
 * 少なくとも一方は必ず付くので、無いことは「ブラウザの通常の経路ではない」を意味する。
 *
 * Astro にも組み込みの CSRF 保護 (`security.checkOrigin`) があるが、**あれは代わりにならない**。
 * 弾くのは「フォーム系の `Content-Type` か、`Content-Type` が無い要求」だけで、
 * `application/json` は素通りする (`astro/dist/core/app/origin-check.js`)。
 * これから増える API は JSON で叩くので、実質そこを守るのはここになる。
 */

/** 判定の理由。拒否したときに何が起きたか分かるようにする。 */
export type OriginVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

export function verifyRequestOrigin(
  request: Request,
  webOrigin: string
): OriginVerdict {
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");

  if (site === null && origin === null) {
    return {
      ok: false,
      reason: "Origin も Sec-Fetch-Site も無い要求は受け付けません",
    };
  }

  // same-site はサブドメインを含む = 実行オリジンからの要求が紛れる。
  if (site !== null && site !== "same-origin") {
    return { ok: false, reason: `Sec-Fetch-Site が ${site} です` };
  }

  if (origin !== null && origin !== webOrigin) {
    return { ok: false, reason: `Origin が ${origin} です` };
  }

  return { ok: true };
}

/** 拒否をそのまま返せる形にする。理由は本文に出す (攻撃者に有用な情報は含まない)。 */
export function forbiddenResponse(verdict: OriginVerdict): Response | null {
  if (verdict.ok) return null;
  return Response.json(
    { error: "forbidden", reason: verdict.reason },
    { status: 403 }
  );
}
