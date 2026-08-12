/**
 * 作品の中身 (ファイル一式) の読み書き。
 *
 * 正本は作者自身の Gist で、ここはその代理をする口 (ADR 0002 / 0010)。D1 に入るのは
 * `gist_id` だけで、コードは通り過ぎるだけ。
 *
 * **どちらも所有者に限る**。閲覧者への配信はキャッシュ層 (2-5) の担当で、ここを匿名に
 * 開けると Workers の共有 IP で GitHub の匿名レート制限 (60 回/時) を焼いてしまう。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
  parseSketchFiles,
  validateSketchFiles,
  type SketchFiles,
} from "@p5stage/shared";

import {
  createGist,
  deleteGist,
  fetchGist,
  GistError,
  updateGist,
  type GistRevision,
} from "../../../../lib/github/gist";
import {
  jsonError,
  readJsonBody,
  rejectForeignOrigin,
  requireSession,
} from "../../../../lib/http/api";
import {
  buildGistFiles,
  gistDescription,
  replaceableNames,
  unsavableFileNames,
} from "../../../../lib/sketches/gist-payload";
import { isSketchId } from "../../../../lib/sketches/id";
import type { Sketch } from "../../../../lib/sketches/sketch";
import {
  attachGist,
  getSketch,
  touchSketch,
} from "../../../../lib/sketches/store";

export const prerender = false;

/** 見つからない。**他人のものだった場合もこれを返す** (存在を漏らさない)。 */
function notFound(): Response {
  return jsonError(404, "not_found", "作品が見つかりません");
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * GitHub 起因の失敗を HTTP に移す。
 *
 * 種類ごとに分けるのは、利用者の次の一手が違うため (ログインし直す / 待つ / 直す)。
 * 中身の分からない 500 にまとめると、どれも「もう一度試す」しかなくなる。
 */
function fromGistError(error: GistError): Response {
  switch (error.kind) {
    case "auth":
      return jsonError(401, "github_auth", error.message);
    case "rate_limit":
      return jsonError(429, "github_rate_limit", error.message);
    case "rejected":
      return jsonError(422, "github_rejected", error.message);
    case "not_found":
      // 作品はあるが Gist が無い = GitHub 側で消された。作り直す口は 2-6 (detach)。
      return jsonError(
        409,
        "gist_missing",
        "GitHub 側で Gist が見つかりません。削除された可能性があります"
      );
    default:
      return jsonError(502, "github_unavailable", error.message);
  }
}

/** 所有者として作品を引く。持ち主でなければ null (「無い」と区別しない)。 */
async function ownedSketch(
  id: string,
  ownerId: number
): Promise<Sketch | null> {
  const sketch = await getSketch(env.DB, id);
  if (sketch === null || sketch.ownerId !== ownerId) return null;
  return sketch;
}

/** 本文から保存するファイル構成を取り出す。読めなければ理由を返す。 */
function readFiles(
  body: unknown
): { files: SketchFiles } | { response: Response } {
  const source = (body ?? {}) as { files?: unknown };
  const files = parseSketchFiles(source.files);
  if (files === null) {
    return {
      response: jsonError(400, "invalid_files", "ファイル構成が不正です"),
    };
  }

  const errors = validateSketchFiles(files);
  if (errors.length > 0) {
    return { response: jsonError(400, "invalid_files", errors.join(" / ")) };
  }

  // Gist は中身が空・空白だけのファイルを受け付けない (ADR 0010)。
  const unsavable = unsavableFileNames(files);
  if (unsavable.length > 0) {
    return {
      response: jsonError(
        400,
        "empty_file",
        `中身が空のファイルは保存できません: ${unsavable.join(", ")}`
      ),
    };
  }

  return { files };
}

/** 初回。Gist を作って作品に紐付ける。 */
async function createAndAttach(
  sketch: Sketch,
  token: string,
  files: SketchFiles
): Promise<{ revision: GistRevision } | { response: Response }> {
  const revision = await createGist({
    token,
    files: buildGistFiles(files),
    description: gistDescription(sketch.title),
    // 公開範囲は**ここでしか決められない** (GitHub は後から変えられない)。
    isPublic: sketch.visibility === "public",
  });

  const attached = await attachGist(
    env.DB,
    sketch.id,
    sketch.ownerId,
    revision.id,
    Date.now()
  );
  if (attached) return { revision };

  // 別タブが先に紐付けた。こちらが作った Gist は行き場が無いので片付ける
  // (残すと利用者の GitHub に誰も辿れない Gist が溜まる)。
  try {
    await deleteGist(token, revision.id);
  } catch {
    // 消せなくても、この保存が失敗したことに変わりはない。
  }
  return {
    response: jsonError(
      409,
      "already_attached",
      "別のタブで先に保存されました。読み込み直してください"
    ),
  };
}

/** 2 回目以降。今の Gist との差分を作って PATCH する。 */
async function updateAttached(
  sketch: Sketch,
  gistId: string,
  token: string,
  files: SketchFiles
): Promise<GistRevision> {
  // 今 Gist にあるファイル名を先に見る。PATCH は**送らなかったファイルを残す**ので、
  // これが無いとエディタで消したファイルが Gist に残り、次に開くと甦る。
  // 条件付き GET で往復を省くのはキャッシュ層 (2-5) の担当。
  const current = await fetchGist(token, gistId);

  const revision = await updateGist({
    token,
    gistId,
    files: buildGistFiles(files, replaceableNames(current)),
    description: gistDescription(sketch.title),
  });

  await touchSketch(env.DB, sketch.id, sketch.ownerId, Date.now());
  return revision;
}

export const PUT: APIRoute = async ({ request, url, params }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  const parsed = await readJsonBody(request);
  if ("response" in parsed) return parsed.response;

  const read = readFiles(parsed.body);
  if ("response" in read) return read.response;

  const sketch = await ownedSketch(id, auth.session.user.id);
  if (sketch === null) return notFound();

  try {
    if (sketch.gistId === null) {
      const created = await createAndAttach(
        sketch,
        auth.session.token,
        read.files
      );
      if ("response" in created) return created.response;
      return noStore({
        sketch: { ...sketch, gistId: created.revision.id },
        gist: created.revision,
      });
    }

    const revision = await updateAttached(
      sketch,
      sketch.gistId,
      auth.session.token,
      read.files
    );
    return noStore({ sketch, gist: revision });
  } catch (error) {
    if (error instanceof GistError) return fromGistError(error);
    throw error;
  }
};

export const GET: APIRoute = async ({ request, params }) => {
  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  const sketch = await ownedSketch(id, auth.session.user.id);
  if (sketch === null) return notFound();

  // 器だけ作って一度も保存していない状態。エラーではない。
  if (sketch.gistId === null) {
    return noStore({ sketch, gist: null, files: null, truncated: [] });
  }

  try {
    const content = await fetchGist(auth.session.token, sketch.gistId);
    return noStore({
      sketch,
      gist: { id: content.id, url: content.url, revision: content.revision },
      files: content.files,
      // 大きすぎて取れなかったファイルは名前だけ返す。黙って欠けた状態で
      // 編集させると、次の保存でその中身が失われる。
      truncated: content.truncated,
    });
  } catch (error) {
    if (error instanceof GistError) return fromGistError(error);
    throw error;
  }
};
