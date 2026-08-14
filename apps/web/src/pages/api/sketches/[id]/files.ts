/**
 * 作品の中身 (ファイル一式) の読み書き。
 *
 * 正本は作者自身の Gist で、ここはその代理をする口 (ADR 0002 / 0010)。D1 に入るのは
 * `gist_id` だけで、コードは通り過ぎるだけ。
 *
 * **どちらも所有者に限る**。閲覧者への配信は別経路 (D1 のポインタ → R2 の不変
 * オブジェクト — ADR 0011) が受け持つ。ここを匿名に開けると、閲覧のたびに
 * GitHub を叩く形に戻ってしまう。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
  parseSketchFiles,
  validateSketchFiles,
  type SketchFiles,
} from "@p5stage/shared";

import {
  checkManifest,
  unclaimedMessage,
} from "../../../../lib/assets/manifest-check";
import { unclaimedDigests } from "../../../../lib/assets/store";
import {
  createGist,
  deleteGist,
  fetchGist,
  GistError,
  updateGist,
  type GistRevision,
} from "../../../../lib/github/gist";
import { fromGistError } from "../../../../lib/github/gist-http";
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
import { githubOrigins } from "../../../../lib/session/context";
import { isSketchId } from "../../../../lib/sketches/id";
import { publishRevision } from "../../../../lib/sketches/publish";
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

/**
 * アセットの一覧 (assets.json) を確かめる (Phase 3-2)。断るなら応答を返す。
 *
 * 保存できてしまうと**正本の Gist に壊れたまま残る**ので、GitHub へ送る前に見る。
 * 参照している blob を持ち込んでいるかは台帳に聞く — 所有していない blob を
 * 参照できると、クォータを使わずにアセットを持つ作品が作れてしまう (ADR 0003 の補足)。
 */
async function checkManifestOwnership(
  userId: number,
  files: SketchFiles
): Promise<Response | null> {
  const check = checkManifest(files);
  if (check.kind === "absent") return null;
  if (check.kind === "invalid") {
    return jsonError(400, "invalid_manifest", check.message);
  }

  const unclaimed = await unclaimedDigests(env.DB, userId, check.digests);
  if (unclaimed.length > 0) {
    return jsonError(400, "unknown_asset", unclaimedMessage(unclaimed.length));
  }
  return null;
}

/** 初回。Gist を作って作品に紐付ける。 */
async function createAndAttach(
  apiOrigin: string,
  sketch: Sketch,
  token: string,
  files: SketchFiles
): Promise<{ revision: GistRevision } | { response: Response }> {
  const revision = await createGist({
    apiOrigin,
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
    await deleteGist(apiOrigin, token, revision.id);
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
  apiOrigin: string,
  sketch: Sketch,
  gistId: string,
  token: string,
  files: SketchFiles
): Promise<GistRevision> {
  // 今 Gist にあるファイル名を先に見る。PATCH は**送らなかったファイルを残す**ので、
  // これが無いとエディタで消したファイルが Gist に残り、次に開くと甦る。
  // ここは所有者の保存経路なので条件付き GET にしない。差分を作るには
  // 「今 Gist にある名前」が要り、304 では手に入らない。
  const current = await fetchGist(apiOrigin, token, gistId);

  const revision = await updateGist({
    apiOrigin,
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

  const manifest = await checkManifestOwnership(
    auth.session.user.id,
    read.files
  );
  if (manifest !== null) return manifest;

  const apiOrigin = githubOrigins().api;

  try {
    if (sketch.gistId === null) {
      const created = await createAndAttach(
        apiOrigin,
        sketch,
        auth.session.token,
        read.files
      );
      if ("response" in created) return created.response;
      const published = await publishRevision(
        sketch.id,
        created.revision.id,
        created.revision.revision,
        read.files,
        // ETag は保存の応答には無い形で来る。次の再検証で埋まる。
        null
      );
      return noStore({
        sketch: { ...sketch, gistId: created.revision.id },
        gist: created.revision,
        published,
      });
    }

    const revision = await updateAttached(
      apiOrigin,
      sketch,
      sketch.gistId,
      auth.session.token,
      read.files
    );
    const published = await publishRevision(
      sketch.id,
      sketch.gistId,
      revision.revision,
      read.files,
      null
    );
    return noStore({ sketch, gist: revision, published });
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
    const content = await fetchGist(
      githubOrigins().api,
      auth.session.token,
      sketch.gistId
    );
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
