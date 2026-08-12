/**
 * 保存した中身を配信側へ渡す (ADR 0011)。
 *
 * ここが**配信の主経路**。中身が手元にある瞬間に R2 へ書いてポインタを進めておけば、
 * 閲覧者は GitHub を 1 回も叩かずに読める。中身が手元に来るのは保存 (2-3) と
 * 取り込み (2-6) の 2 か所なので、どちらからも同じ道を通す。
 */

import { env } from "cloudflare:workers";
import type { SketchFiles } from "@p5stage/shared";

import { putRevision } from "./revision-store";
import { setCurrentRevision } from "./store";

/**
 * R2 へ書いて、配信するリビジョンを進める。書けたら true。
 *
 * **失敗しても呼び出し側は成功として返してよい**。正本 (Gist) には既に書けている
 * ので、ここで失敗を返すと利用者が同じ操作を繰り返すことになる。配信側は次の閲覧で
 * 自分で埋め直す (`resolveSketchContent` の fill 経路)。
 */
export async function publishRevision(
  sketchId: string,
  gistId: string,
  revision: string,
  files: SketchFiles
): Promise<boolean> {
  try {
    await putRevision(env.CONTENT, gistId, revision, files);
    // ETag はここでは取れない (保存の応答にも読み出しの応答にも無い形で来る)。
    // 次の再検証で埋まる。
    await setCurrentRevision(env.DB, sketchId, revision, null, Date.now());
    return true;
  } catch {
    return false;
  }
}
