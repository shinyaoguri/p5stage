/**
 * 作品をフォークする (Phase 4-3 / #44 / ADR 0018)。
 *
 * 作品から作品を作る道。D1 には**系譜を刻んだ新しい作品**ができ、GitHub 側では
 * 相手によって違うことをする — 他人の Gist なら fork API (`Forked from` が付き、
 * blob も共有される)、自分の Gist なら新規作成 (**自分の Gist は自分で fork
 * できない** — #44)。系譜の正典はこちら側で、GitHub のリンクはボーナス。
 *
 * 分岐は **Gist の持ち主**で取る。回避したい制約は GitHub 側のものであって、
 * D1 の所有ではない。
 *
 * **GitHub に何かを作る前に、親の Gist を 1 回読む。** 検証もクォータの判定も
 * 手前で済ませ、断るときに利用者のアカウントへフォーク済みの Gist を残さない。
 * 読んだ版の SHA がそのまま `forked_from_revision` になる (D1 の
 * `current_revision` で代用すると、作者が GitHub 側で直接編集していたときに
 * 実際に複製した版とは違う SHA を刻む)。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { quotaError } from "../../../../lib/assets/asset";
import {
  assetUsage,
  blobSizes,
  claimBlobs,
  unclaimedDigests,
} from "../../../../lib/assets/store";
import {
  createGist,
  deleteGist,
  fetchGist,
  forkGist,
  GistError,
  type GistContent,
} from "../../../../lib/github/gist";
import { fromGistError } from "../../../../lib/github/gist-http";
import {
  jsonError,
  rejectForeignOrigin,
  requireSession,
} from "../../../../lib/http/api";
import { githubOrigins } from "../../../../lib/session/context";
import {
  planSketchFork,
  type ForkRejectionReason,
} from "../../../../lib/sketches/fork";
import {
  buildGistFiles,
  gistDescription,
} from "../../../../lib/sketches/gist-payload";
import { isSketchId } from "../../../../lib/sketches/id";
import { publishRevision } from "../../../../lib/sketches/publish";
import type { Sketch } from "../../../../lib/sketches/sketch";
import {
  createSketchFromGist,
  getSketch,
  getSketchByGistId,
} from "../../../../lib/sketches/store";

export const prerender = false;

/** 無い作品も、中身を出せない作品も同じ 404 (存在を漏らさない)。 */
function notFound(): Response {
  return jsonError(404, "not_found", "作品が見つかりません");
}

/** 受け入れられなかった理由を HTTP に移す。 */
function fromRejection(reason: ForkRejectionReason, message: string): Response {
  // どれも「要求の形は正しいが、その作品は複製できない」。本文の不備 (400) とは違う。
  return jsonError(422, reason, message);
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const POST: APIRoute = async ({ params, request, url }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const id = params.id ?? "";
  if (!isSketchId(id)) return notFound();

  const parent = await getSketch(env.DB, id);
  if (parent === null) return notFound();

  // まだ中身が書き出されていない作品には、複製する先がない。
  if (parent.gistId === null) {
    return jsonError(
      409,
      "not_saved",
      "この作品はまだ保存されていないので、フォークできません"
    );
  }

  let source: GistContent;
  try {
    // 読むのは閲覧者のトークン。公開 Gist も secret gist も、ID を知っていれば
    // 読める (作品ページを開ける条件と同じ強度 — ADR 0018)。
    source = await fetchGist(
      githubOrigins().api,
      auth.session.token,
      parent.gistId
    );
  } catch (error) {
    if (error instanceof GistError) {
      // 既定の 404 は「Gist を外して保存し直せます」と案内するが、**他人の作品を
      // フォークしようとした人にその権限は無い**。専用の文言に差し替える。
      return fromGistError(
        error,
        jsonError(
          404,
          "gist_not_found",
          "元になった Gist が見つかりません。作者が削除したか、非公開にした可能性があります"
        )
      );
    }
    throw error;
  }

  const decision = planSketchFork(source, auth.session.user.id);
  if (decision.kind === "reject") {
    return fromRejection(decision.reason, decision.message);
  }

  /*
   * アセットを引き受けられるかを、GitHub に何かを作る前に決める。
   *
   * フォークは**他人の blob を自分に計上する**唯一の経路 (ADR 0003 の補足が
   * Phase 4 に預けたもの)。台帳に実体が無いものは計上しようがないので断り、
   * 既に自分が持っている分は二重に数えない。
   */
  const sizes = await blobSizes(env.DB, decision.digests);
  const missing = decision.digests.filter((digest) => !sizes.has(digest));
  if (missing.length > 0) {
    return fromRejection(
      "unknown_asset",
      `元の作品が参照しているアセット ${missing.length} 件が見つからないため、フォークできません`
    );
  }

  const newDigests = await unclaimedDigests(
    env.DB,
    auth.session.user.id,
    decision.digests
  );
  const addedBytes = newDigests.reduce(
    (total, digest) => total + (sizes.get(digest) ?? 0),
    0
  );
  if (addedBytes > 0) {
    const over = quotaError(
      addedBytes,
      await assetUsage(env.DB, auth.session.user.id)
    );
    if (over !== null) return jsonError(409, "quota_exceeded", over);
  }

  // 公開範囲は元に従う。fork では選べず (元が secret なら secret)、複製でも
  // 揃える — 経路で挙動が変わると、利用者から見て同じ操作の結果が変わる。
  const isPublic = parent.visibility === "public";

  let content: GistContent;
  try {
    if (decision.route === "copy") {
      /*
       * 自分の Gist は自分で fork できない (422) ので、新しい Gist を作る (#44)。
       *
       * 中身は**今読んだ親のもの**をそのまま送る。作成の応答は書き込みの形
       * (`history` を持つ) なので、fork のように読み直す必要はない。
       */
      const created = await createGist({
        apiOrigin: githubOrigins().api,
        token: auth.session.token,
        files: buildGistFiles(source.files),
        description: gistDescription(parent.title),
        isPublic,
      });
      content = {
        ...created,
        files: source.files,
        truncated: [],
        description: gistDescription(parent.title),
        ownerId: auth.session.user.id,
        isPublic,
      };
    } else {
      const forkedGistId = await forkGist(
        githubOrigins().api,
        auth.session.token,
        parent.gistId
      );
      // fork の応答は読み出しと同じ形ではない (中身も版も入らない) ので、
      // できた Gist を改めて読む。
      content = await fetchGist(
        githubOrigins().api,
        auth.session.token,
        forkedGistId
      );
    }
  } catch (error) {
    if (error instanceof GistError) return fromGistError(error);
    throw error;
  }

  // 作品より先に計上する。途中で落ちたときに残るのが「余計な計上」(手放せる) か
  // 「保存できない作品」(直せない) かの違い。
  await claimBlobs(env.DB, auth.session.user.id, newDigests, Date.now());

  const lineage = { sketchId: parent.id, revision: source.revision };
  let sketch: Sketch;
  try {
    sketch = await createSketchFromGist(
      env.DB,
      auth.session.user.id,
      {
        title: parent.title,
        description: parent.description,
        // **できた Gist に従う**。作成後は変えられない値なので (ADR 0010)、
        // こちらの意図ではなくあちらの事実を写す。
        visibility: content.isPublic ? "public" : "unlisted",
      },
      content.id,
      Date.now(),
      lineage
    );
  } catch (error) {
    // GitHub が同じ Gist を返した (再 fork) 場合、`gist_id` の UNIQUE で落ちる。
    // 先にできている作品が自分のものなら、利用者の目的は果たされている。
    const raced = await getSketchByGistId(env.DB, content.id);
    if (raced !== null && raced.ownerId === auth.session.user.id) {
      return await respond(raced, content, 200);
    }

    // 誰からも辿れない Gist を利用者のアカウントに残さない (`createAndAttach` と
    // 同じ後始末)。片付けに失敗しても、伝えるべきは元の失敗の方。
    try {
      await deleteGist(githubOrigins().api, auth.session.token, content.id);
    } catch {
      /* 元の失敗を投げ直す */
    }
    throw error;
  }

  return await respond(sketch, content, 201);
};

/** できた作品の中身を配信側へ渡してから応答する。 */
async function respond(
  sketch: Sketch,
  content: GistContent,
  status: number
): Promise<Response> {
  const published = await publishRevision(
    sketch.id,
    content.id,
    content.revision,
    content.files,
    // ETag はこの応答には無い形で来る。次の再検証で埋まる。
    null
  );

  return noStore(
    {
      sketch,
      gist: { id: content.id, url: content.url, revision: content.revision },
      files: content.files,
      published,
    },
    status
  );
}
