/**
 * 外部にある自分の Gist を作品として取り込む (Phase 2-6 / ADR 0012)。
 *
 * その Gist を**そのまま正本にする**。中身は複製せず、GitHub 側には何も作らない。
 * 受け入れた後は 2-3 で作った作品と何も変わらない (保存は PATCH、配信は R2)。
 *
 * 他人の Gist はここでは扱わない。fork API と D1 の系譜で受け持つ (#44 / Phase 4)。
 *
 * このパスは `[id].ts` より優先される (Astro は静的な区切りを動的より先に見る)。
 * `adopt` は作品 ID の形 (base64url 16 桁) を満たさないので、取り違えも起きない。
 */

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { unclaimedAdoptMessage } from "../../../lib/assets/manifest-check";
import { unclaimedDigests } from "../../../lib/assets/store";
import {
  fetchGist,
  GistError,
  type GistContent,
} from "../../../lib/github/gist";
import { fromGistError } from "../../../lib/github/gist-http";
import {
  jsonError,
  readJsonBody,
  rejectForeignOrigin,
  requireSession,
} from "../../../lib/http/api";
import { githubOrigins } from "../../../lib/session/context";
import {
  planGistAdoption,
  type AdoptionRejectionReason,
} from "../../../lib/sketches/gist-adopt";
import { parseGistRef } from "../../../lib/sketches/gist-ref";
import { publishRevision } from "../../../lib/sketches/publish";
import type { Sketch } from "../../../lib/sketches/sketch";
import {
  createSketchFromGist,
  getSketchByGistId,
} from "../../../lib/sketches/store";

export const prerender = false;

/** 受け入れられなかった理由を HTTP に移す。 */
function fromRejection(
  reason: AdoptionRejectionReason,
  message: string
): Response {
  // どれも「要求の形は正しいが、その Gist は使えない」。本文の不備 (400) とは違う。
  const error = reason === "not_owner" ? "not_gist_owner" : reason;
  return jsonError(reason === "not_owner" ? 403 : 422, error, message);
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const POST: APIRoute = async ({ request, url }) => {
  const foreign = rejectForeignOrigin(request, url);
  if (foreign !== null) return foreign;

  const auth = await requireSession(request, Date.now());
  if ("response" in auth) return auth.response;

  const parsed = await readJsonBody(request);
  if ("response" in parsed) return parsed.response;

  const source = (parsed.body ?? {}) as { gist?: unknown };
  const ref =
    typeof source.gist === "string" ? parseGistRef(source.gist) : null;
  if (ref === null) {
    return jsonError(
      400,
      "invalid_gist_ref",
      "Gist の URL または ID を入力してください"
    );
  }

  let content: GistContent;
  try {
    // 本人のトークンで読む。secret gist も自分のものなら読めるうえ、レート制限も
    // 本人の枠に載る (ADR 0010)。
    content = await fetchGist(githubOrigins().api, auth.session.token, ref);
  } catch (error) {
    if (error instanceof GistError) {
      return fromGistError(
        error,
        jsonError(
          404,
          "gist_not_found",
          "その Gist が見つかりません。URL を確認してください"
        )
      );
    }
    throw error;
  }

  const decision = planGistAdoption(content, auth.session.user.id);
  if (decision.kind === "reject") {
    return fromRejection(decision.reason, decision.message);
  }

  // 参照している実体を持ち込んでいるかは台帳に聞く (保存経路と同じ規則 — #65)。
  // sha256 を書くだけで他人の blob を参照できると、クォータを一切使わずに
  // アセット付きの作品が作れてしまう (ADR 0003 の補足)。
  //
  // **この位置でしか塞げない**。以下の 3 つの出口 (新規 201 / 既に取り込み済み 200 /
  // 競合 200) はどれも `respond` = `publishRevision` に落ち、R2 の写しと参照台帳と
  // 配信のポインタが同時に進む。分岐の前なら D1 へ 1 行も書かずに断れる。
  const unclaimed = await unclaimedDigests(
    env.DB,
    auth.session.user.id,
    decision.digests
  );
  if (unclaimed.length > 0) {
    return fromRejection(
      "unknown_asset",
      unclaimedAdoptMessage(unclaimed.length)
    );
  }

  // 既に取り込まれている Gist を二度渡されたら、作り直さずその作品へ案内する。
  // 同じ Gist を指す作品が 2 つあると、どちらの保存が正本に届くのか決まらない。
  const existing = await getSketchByGistId(env.DB, content.id);
  if (existing !== null) {
    if (existing.ownerId !== auth.session.user.id) {
      return jsonError(
        409,
        "already_adopted",
        "この Gist は既に別の作品として取り込まれています"
      );
    }
    return await respond(existing, content, 200);
  }

  let sketch: Sketch;
  try {
    sketch = await createSketchFromGist(
      env.DB,
      auth.session.user.id,
      {
        title: decision.title,
        description: "",
        visibility: decision.visibility,
      },
      content.id,
      Date.now()
    );
  } catch (error) {
    // 別のタブが同じ Gist を先に取り込んだ (gist_id は UNIQUE)。作れなかった理由が
    // それなら、先にできた作品を返せば利用者の目的は果たされる。
    const raced = await getSketchByGistId(env.DB, content.id);
    if (raced === null || raced.ownerId !== auth.session.user.id) throw error;
    return await respond(raced, content, 200);
  }

  return await respond(sketch, content, 201);
};

/** 取り込んだ中身を配信側へ渡してから応答する。 */
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
    // ETag は取り込みの応答には無い形で来る。次の再検証で埋まる。
    null
  );

  return noStore(
    {
      sketch: { ...sketch, gistId: content.id },
      gist: { id: content.id, url: content.url, revision: content.revision },
      // エディタはこの中身をそのまま開く。取り込み直後にもう一度読みに行くのは
      // GitHub の消費が二重になるだけ。
      files: content.files,
      published,
    },
    status
  );
}
