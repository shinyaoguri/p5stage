/**
 * GitHub 起因の失敗を HTTP に移す (Phase 2-3 / 2-6)。
 *
 * 種類ごとに分けるのは、利用者の次の一手が違うため (ログインし直す / 待つ / 直す)。
 * 中身の分からない 500 にまとめると、どれも「もう一度試す」しかなくなる。
 *
 * Gist を叩く口が保存と取り込みの 2 つになったので、対応表をここに 1 つ置く。
 * 分かれていると、片方だけ 502 のままといったずれが静かに入る。
 */

import { jsonError } from "../http/api";

import type { GistError } from "./gist";

/**
 * @param notFound 404 だったときに返す応答。「Gist が無い」の意味が口によって違う
 *   ため差し替えられるようにしてある — 保存中なら「GitHub 側で消された」(作品はある
 *   ので 409)、取り込みなら「その URL の Gist が無い」(404)。
 */
export function fromGistError(
  error: GistError,
  notFound: Response = jsonError(
    409,
    "gist_missing",
    // 作品はあるが Gist が無い = GitHub 側で消された。次の一手は切り離し (2-6) で、
    // 保存し直すと新しい Gist ができる。
    "GitHub 側で Gist が見つかりません。削除された可能性があります。「Gist を外す」と新しい Gist に保存し直せます"
  )
): Response {
  switch (error.kind) {
    case "auth":
      return jsonError(401, "github_auth", error.message);
    case "rate_limit":
      return jsonError(429, "github_rate_limit", error.message);
    case "rejected":
      return jsonError(422, "github_rejected", error.message);
    case "not_found":
      return notFound;
    default:
      return jsonError(502, "github_unavailable", error.message);
  }
}
