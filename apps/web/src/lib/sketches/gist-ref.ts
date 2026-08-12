/**
 * 人が貼り付けた文字列から Gist の ID を取り出す (Phase 2-6)。
 *
 * 取り込みの入口は「Gist の URL を貼る」なので、ここが**外から来る値の最初の関門**に
 * なる。GitHub まで持っていく前に形で足切りしておくと、無駄な往復もレート制限の
 * 消費も起きない。
 */

/**
 * Gist の ID。16 進の並び (歴史的に 20 桁と 32 桁がある)。
 *
 * 長さを幅で見るのは、GitHub が桁数を明言していないため。上下の幅を持たせつつ、
 * 16 進以外は弾く — これで「URL の別の部分」や打ち間違いはここで止まる。
 */
const GIST_ID = /^[0-9a-f]{16,64}$/i;

/**
 * Gist の URL として受け付けるホスト。
 *
 * ここを見ずに「16 進らしき部分」を拾うと、無関係な URL でも取り込みが始まって
 * しまう。読みに行く先は GitHub だけなので、入口でもそう名乗るものだけ通す。
 */
const HOSTS = new Set([
  "gist.github.com",
  "gist.githubusercontent.com",
  "github.com",
  "api.github.com",
]);

/** URL のパスを、空要素を除いた区切りの並びにする。GitHub 以外なら null。 */
function githubPathSegments(input: string): string[] | null {
  // スキームを略して貼られることは普通にある (gist.github.com/... など)。
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  return url.pathname.split("/").filter((segment) => segment !== "");
}

/**
 * Gist の URL または ID から ID を取り出す。読めなければ null。
 *
 * 拾うのは**最初に見つかった 16 進の区切り**。`/<login>/<id>/raw/<sha>/<file>` の
 * ような形では sha も 16 進なので、後ろから拾うと別物 (リビジョン) を掴む。
 * ID は必ず sha より前に来る。
 */
export function parseGistRef(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (GIST_ID.test(text)) return text;

  const segments = githubPathSegments(text);
  if (segments === null) return null;

  return segments.find((segment) => GIST_ID.test(segment)) ?? null;
}
