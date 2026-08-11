/**
 * ランナーへ本体オリジンを埋め込む。
 *
 * ランナーは静的アセットなので、デプロイ環境ごとに変わる本体オリジンを
 * ビルド時には持てない。配信時に Worker が置換する (ADR 0007)。
 * postMessage の相手を決める値なので、埋め込み経路は Worker だけに限る。
 */

/** ランナーの HTML に置く目印。 */
export const WEB_ORIGIN_PLACEHOLDER = "__P5STAGE_WEB_ORIGIN__";

/** HTML 属性値として安全にする。オリジンは検証済みだが、埋め込み側でも落とす。 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function injectWebOrigin(html: string, webOrigin: string): string {
  return html.split(WEB_ORIGIN_PLACEHOLDER).join(escapeAttribute(webOrigin));
}

/** HTML として配信されているか。置換は HTML にだけ行う。 */
export function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.split(";")[0]?.trim().toLowerCase() === "text/html";
}
