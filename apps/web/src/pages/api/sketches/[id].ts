/**
 * 作品 1 件の取得と更新。
 *
 * 取得はログイン不要 (閲覧に会員登録は要らない — 要件 3.4)。`unlisted` も ID を
 * 知っていれば読める。**「URL を知る人は誰でも見られる」がその公開範囲の定義**であって、
 * 隠されているのは ID だけ。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import {
  jsonError,
  readJsonBody,
  rejectForeignOrigin,
  requireSession,
} from "../../../lib/http/api";
import { isSketchId } from "../../../lib/sketches/id";
import {
  parseSketchPatch,
  SketchInputError,
} from "../../../lib/sketches/sketch";
import {
  getSketch,
  listTagsForSketch,
  replaceTags,
  updateSketch,
} from "../../../lib/sketches/store";
import { parseTags } from "../../../lib/sketches/tags";

export const prerender = false;

/** 見つからない。**他人のものだった場合もこれを返す** (存在を漏らさない)。 */
function notFound(): Response {
  return jsonError(404, "not_found", "作品が見つかりません");
}

/** `sketches` の列にあたる項目。タグはここに入らない (別の表 — Phase 5)。 */
const COLUMN_FIELDS = ["title", "description", "visibility"] as const;

function hasKey(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && key in body;
}

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";
  // 形が違う値を D1 まで持って行かない。存在の確認ではなく足切り。
  if (!isSketchId(id)) return notFound();

  const sketch = await getSketch(env.DB, id);
  if (sketch === null) return notFound();

  // タグは別の表なので作品と一緒には出てこない (Phase 5)。エディタが開いた作品に
  // 今どのタグが付いているかを知る口はここ。
  const tags = await listTagsForSketch(env.DB, id);

  return Response.json(
    { sketch, tags },
    {
      // 限定公開の URL が共有キャッシュに載ると、ID を知らない相手にも届きうる。
      // この口は公開範囲を見ずに答えるので、まとめて載せない。エッジに載せるのは
      // 公開範囲を分かって描く作品ページの方 (ADR 0011)。
      headers: { "Cache-Control": "private, no-store" },
    }
  );
};

export const PATCH: APIRoute = async ({ request, url, params }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  const parsed = await readJsonBody(request);
  if ("response" in parsed) return parsed.response;

  try {
    // タグは別の表なので `SketchPatch` には混ぜず、ここで分けて読む (Phase 5)。
    // **タグだけを送る PATCH も通す** — エディタのタグ編集はそれしか送らない。
    const tags = hasKey(parsed.body, "tags")
      ? parseTags((parsed.body as Record<string, unknown>).tags)
      : null;
    const patch = COLUMN_FIELDS.some((field) => hasKey(parsed.body, field))
      ? parseSketchPatch(parsed.body)
      : null;
    if (patch === null && tags === null) {
      throw new SketchInputError("変更する項目がありません");
    }

    // 公開範囲は Gist を作った時点で固定される。GitHub は後から public / secret を
    // 変えられないので、D1 だけ書き換えると「限定公開にしたのに Gist は公開のまま」
    // という嘘になる (ADR 0010)。所有の確認は下の UPDATE が SQL でやるので、
    // ここで引くのは**この制約を説明するため**だけ。
    if (patch?.visibility !== undefined) {
      const current = await getSketch(env.DB, id);
      if (
        current !== null &&
        current.ownerId === auth.session.user.id &&
        current.gistId !== null &&
        current.visibility !== patch.visibility
      ) {
        return jsonError(
          409,
          "visibility_locked",
          "保存済みの作品は公開範囲を変えられません (GitHub の Gist は作成後に公開範囲を変更できないため)"
        );
      }
    }

    // 持ち主でなければどちらも空振りする。「無い」と同じ応答にして、存在を
    // 確かめる手掛かりを与えない。
    const now = Date.now();
    if (patch !== null) {
      const updated = await updateSketch(
        env.DB,
        id,
        auth.session.user.id,
        patch,
        now
      );
      if (updated === null) return notFound();
    }
    if (tags !== null) {
      const owned = await replaceTags(
        env.DB,
        id,
        auth.session.user.id,
        tags,
        now
      );
      if (!owned) return notFound();
    }

    // 書いた後の姿を引き直す。タグの付け替えも `updated_at` を進めるので、
    // 更新の戻り値をそのまま返すと 1 手前の作品を返してしまう。
    const sketch = await getSketch(env.DB, id);
    if (sketch === null) return notFound();

    return Response.json(
      { sketch, tags: tags ?? (await listTagsForSketch(env.DB, id)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof SketchInputError) {
      return jsonError(400, "invalid_input", error.message);
    }
    throw error;
  }
};
