/**
 * 1 つの版の中身だけを返す (Phase 4-2 / ADR 0017)。
 *
 * 4-1 (#73) が「中身だけを `immutable` で配る JSON の口は、必要になる次の縦切りで
 * 作る」と予告した分。同期で新しい版を受けた閲覧側が、**ページ全体を読み直さずに**
 * 実行とコード表示を差し替えるのに要る。
 *
 * 解決は作品ページの `?rev=` と同じ `resolveRevisionContent` を通す。つまり
 * **台帳と R2 だけで閉じ、GitHub へは行かない** (ADR 0011 / 0016)。ここを配信の
 * 埋め合わせ経路に繋ぐと、存在しない版を並べた要求のたびに Gist API を叩く口になる。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { jsonError } from "../../../../../lib/http/api";
import {
  resolveRevisionContent,
  type RevisionContent,
} from "../../../../../lib/sketches/delivery";
import { isSketchId } from "../../../../../lib/sketches/id";
import {
  isRevisionSha,
  listableGistId,
} from "../../../../../lib/sketches/revision-view";
import { getSketch } from "../../../../../lib/sketches/store";

export const prerender = false;

/**
 * 見つからない。
 *
 * **「作品が無い」「他人のものだった」「その版を持っていない」を区別しない。**
 * 区別すると、当てずっぽうの ID や SHA を並べるだけで存在を確かめられる。
 */
function notFound(): Response {
  return jsonError(404, "not_found", "その版が見つかりません");
}

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";
  const revision = params.rev ?? "";
  if (!isSketchId(id) || !isRevisionSha(revision)) return notFound();

  const sketch = await getSketch(env.DB, id);
  if (sketch === null) return notFound();

  // 履歴を持てない状態 (切り離し済み・tombstone) では過去の版も出さない。
  // 判断は作品ページと同じ 1 か所に寄せてある (ADR 0016)。
  const gistId = listableGistId(sketch);
  if (gistId === null) return notFound();

  const content: RevisionContent = await resolveRevisionContent(
    gistId,
    revision
  );
  // 台帳にあるのに写しが読めない (`gone`) も 404 に倒す。呼び出し側の次の一手は
  // 「無い」ときと同じ — その版は出せないので、今の表示のままにする。
  if (content.kind !== "ready") return notFound();

  return Response.json(
    { revision: content.revision, files: content.files },
    {
      headers: {
        // **不変なのは中身そのもの**なので、ここは長く持たせてよい (作品ページの
        // HTML と違ってタイトルも作者名も入らない — ADR 0016 で分けた話の続き)。
        // 限定公開だけは共有キャッシュに載せない (ADR 0011)。
        "Cache-Control":
          sketch.visibility === "public"
            ? "public, max-age=31536000, immutable"
            : "private, no-store",
      },
    }
  );
};
