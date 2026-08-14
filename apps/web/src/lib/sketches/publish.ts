/**
 * 保存した中身を配信側へ渡す (ADR 0011)。
 *
 * ここが**配信の主経路**。中身が手元にある瞬間に R2 へ書いてポインタを進めておけば、
 * 閲覧者は GitHub を 1 回も叩かずに読める。中身が手元に来るのは保存 (2-3) と
 * 取り込み (2-6) の 2 か所なので、どちらからも同じ道を通す。
 */

import { env } from "cloudflare:workers";
import { referencedDigests, type SketchFiles } from "@p5stage/shared";

import { recordRefs } from "../assets/store";

import { recordRevision } from "./revision-log";
import { putRevision } from "./revision-store";
import { setCurrentRevision } from "./store";

/**
 * リビジョンの写しを R2 へ置き、それが使うアセットを参照台帳へ記し (3-5a)、
 * 版そのものを履歴の台帳へ載せる (4-1)。
 *
 * **R2 へ書く経路はここに集める。** 写しが増えるのは保存・取り込み (`publishRevision`)
 * だけでなく、閲覧時の埋め合わせと再検証 (`delivery.ts` の `fill` / `revalidate`
 * — 作者が GitHub 側で直接編集した分) もある。どれか一つでも素通りすると、
 * **配られているのに台帳に無い** blob ができ、回収 (3-5b) がそれを孤児と見なす。
 *
 * 記録はどちらも R2 へ書けた後。書けていないリビジョンは配られないので、参照を守る
 * 理由も、履歴に並べる理由も無い (履歴に載る版は**開ける**ことが前提 — ADR 0016)。
 */
export async function storeRevision(
  gistId: string,
  revision: string,
  files: SketchFiles,
  now: number
): Promise<void> {
  await putRevision(env.CONTENT, gistId, revision, files);
  await recordRefs(env.DB, gistId, revision, referencedDigests(files), now);
  await recordRevision(env.DB, gistId, revision, now);
}

/**
 * R2 へ書いて、配信するリビジョンを進める。書けたら true。
 *
 * **失敗しても呼び出し側は成功として返してよい**。正本 (Gist) には既に書けている
 * ので、ここで失敗を返すと利用者が同じ操作を繰り返すことになる。配信側は次の閲覧で
 * 自分で埋め直す (`resolveSketchContent` の fill 経路)。
 *
 * ポインタを進めるのは参照を記した後。順を逆にすると、記録に失敗した瞬間から
 * 「配っているのに守られていない」リビジョンが残る。この順なら、失敗しても
 * 配信が進まないだけで済む。
 */
export async function publishRevision(
  sketchId: string,
  gistId: string,
  revision: string,
  files: SketchFiles
): Promise<boolean> {
  try {
    const now = Date.now();
    await storeRevision(gistId, revision, files, now);
    // ETag はここでは取れない (保存の応答にも読み出しの応答にも無い形で来る)。
    // 次の再検証で埋まる。
    await setCurrentRevision(env.DB, sketchId, revision, null, now);
    return true;
  } catch {
    return false;
  }
}
