/**
 * 閲覧者へ中身を配るまでの道筋 (Phase 2-4 / ADR 0011)。
 *
 * **閲覧は GitHub を叩かない**。D1 のポインタ (`current_revision`) と R2 の不変
 * オブジェクトだけで閉じる。GitHub を叩くのは、まだ写しが無いときの埋め合わせと、
 * 古くなったポインタの確かめ直しに限る。おかげで GitHub の消費が閲覧数から
 * 切り離され、**実際に中身が変わった回数**に比例する形になる。
 *
 * どの道を通るかの判断は delivery-plan.ts (純ロジック)。ここは取得と書き込み。
 */

import { env, waitUntil } from "cloudflare:workers";
import type { SketchFiles } from "@p5stage/shared";

import {
  appAuth,
  fetchGistForDelivery,
  GistError,
  type GistAuth,
} from "../github/gist";
import {
  AuthConfigError,
  githubOrigins,
  readOAuthConfig,
} from "../session/context";

import { planDelivery } from "./delivery-plan";
import { storeRevision } from "./publish";
import { findRevision } from "./revision-log";
import { getRevision } from "./revision-store";
import type { Sketch } from "./sketch";
import {
  markGistDeleted,
  markRevisionChecked,
  setCurrentRevision,
} from "./store";

/** 閲覧画面に渡す中身。 */
export type SketchContent =
  | { readonly kind: "unsaved" }
  | { readonly kind: "deleted" }
  | {
      readonly kind: "ready";
      readonly files: SketchFiles;
      readonly revision: string;
    }
  /** 今は出せない (GitHub 側の不調・設定不足)。作品は存在する。 */
  | { readonly kind: "unavailable"; readonly reason: string };

/** 配信用の資格。無ければ理由を持って投げる。 */
function deliveryAuth(): GistAuth {
  const config = readOAuthConfig();
  return appAuth(config.clientId, config.clientSecret);
}

/** GitHub から取って R2 とポインタを埋める。 */
async function fill(
  sketchId: string,
  gistId: string,
  now: number
): Promise<SketchContent> {
  // 手元に中身が無いので条件付きにしない (304 は「手元のものを使え」の意味で、
  // ここでは使えるものが無い)。
  const result = await fetchGistForDelivery(
    githubOrigins().api,
    deliveryAuth(),
    gistId,
    null
  );
  if (result.kind === "unchanged") {
    return {
      kind: "unavailable",
      reason: "GitHub から中身を取得できませんでした",
    };
  }

  const { content } = result;
  await storeRevision(gistId, content.revision, content.files, now);
  await setCurrentRevision(
    env.DB,
    sketchId,
    content.revision,
    result.etag,
    now
  );

  return { kind: "ready", files: content.files, revision: content.revision };
}

/**
 * ポインタを確かめ直す。**表示の裏で走らせる**ので、失敗しても何も言わない。
 *
 * 304 なら時計だけ進める (レート制限は消費していない)。変わっていれば新しい
 * リビジョンを書いてポインタを進める。消えていれば tombstone を立てる。
 */
async function revalidate(sketch: Sketch, now: number): Promise<void> {
  if (sketch.gistId === null) return;

  try {
    const result = await fetchGistForDelivery(
      githubOrigins().api,
      deliveryAuth(),
      sketch.gistId,
      sketch.revisionEtag
    );

    if (result.kind === "unchanged") {
      await markRevisionChecked(env.DB, sketch.id, now);
      return;
    }

    const { content } = result;
    await storeRevision(sketch.gistId, content.revision, content.files, now);
    await setCurrentRevision(
      env.DB,
      sketch.id,
      content.revision,
      result.etag,
      now
    );
  } catch (error) {
    if (error instanceof GistError && error.kind === "not_found") {
      await markGistDeleted(env.DB, sketch.id, now);
      return;
    }
    // それ以外 (レート制限・障害・設定不足) は次の閲覧でやり直す。
    // 今出している中身は正しいので、閲覧者に見せる話は何も無い。
  }
}

/** GitHub 由来の失敗を、閲覧者に見せる言葉へ移す。 */
function unavailableReason(error: unknown): string {
  if (error instanceof AuthConfigError) {
    return "配信の設定が未完了です";
  }
  if (error instanceof GistError) {
    return error.kind === "rate_limit"
      ? "混み合っています。少し時間をおいて開き直してください"
      : "GitHub から中身を取得できませんでした";
  }
  throw error;
}

/**
 * 閲覧者へ渡す中身を用意する。
 *
 * R2 に写しがあれば GitHub には行かない。写しが無い (2-3 以前に保存された作品・
 * R2 側で失われた) ときだけ取りに行って埋め直す。
 */
export async function resolveSketchContent(
  sketch: Sketch,
  now: number
): Promise<SketchContent> {
  const plan = planDelivery(sketch, now);
  if (plan.kind === "unsaved" || plan.kind === "deleted") return plan;

  // planDelivery が unsaved を除いているので必ずある。型を絞るための確認。
  const gistId = sketch.gistId;
  if (gistId === null) return { kind: "unsaved" };

  try {
    if (plan.kind === "serve") {
      const files = await getRevision(env.CONTENT, gistId, plan.revision);
      if (files !== null) {
        if (plan.revalidate) waitUntil(revalidate(sketch, now));
        return { kind: "ready", files, revision: plan.revision };
      }
      // ポインタはあるのに写しが無い。埋め直して自分で治る。
    }

    return await fill(sketch.id, gistId, now);
  } catch (error) {
    if (error instanceof GistError && error.kind === "not_found") {
      await markGistDeleted(env.DB, sketch.id, now);
      return { kind: "deleted" };
    }
    return { kind: "unavailable", reason: unavailableReason(error) };
  }
}

/** 過去の版を開いたときの中身 (Phase 4-1)。 */
export type RevisionContent =
  /** 台帳にない版。作品ページと同じ 404 に揃える。 */
  | { readonly kind: "unknown" }
  /** 台帳にはあるが、R2 の写しが読めない。作品は存在する。 */
  | { readonly kind: "gone"; readonly revision: string }
  | {
      readonly kind: "ready";
      readonly files: SketchFiles;
      readonly revision: string;
      /** p5stage が写しを持った時刻 (GitHub のコミット時刻ではない — ADR 0016)。 */
      readonly createdAt: number;
    };

/**
 * 過去の版の中身を用意する (Phase 4-1 / ADR 0016)。
 *
 * **`resolveSketchContent` と道を分けてある。** あちらは写しが無ければ GitHub から
 * 取って埋めるが、その埋め合わせが取ってくるのは**今の Gist** なので、過去の版の
 * 解決に流用すると「古い版のラベルで最新の中身」を配ることになる。存在しない版を
 * 並べた要求のたびに GitHub を叩く形にもなり、閲覧経路から GitHub を外した
 * ADR 0011 がクエリ 1 つで無効化される。
 *
 * したがってここは **D1 の台帳と R2 だけで閉じる**。GitHub へは行かず、配信の
 * ポインタも書き換えず、再検証も仕掛けない (過去を見ている閲覧者に最新を確かめ
 * させる理由が無い)。
 */
export async function resolveRevisionContent(
  gistId: string,
  revision: string
): Promise<RevisionContent> {
  // URL から来た値なので、R2 を引く前に台帳を通す。
  const entry = await findRevision(env.DB, gistId, revision);
  if (entry === null) return { kind: "unknown" };

  const files = await getRevision(env.CONTENT, gistId, revision);
  // 写しが失われていても埋め直さない。埋め直せるのは今の版だけで、過去の版の
  // 中身は GitHub の Gist API からしか取れない (= 閲覧経路が GitHub に戻る)。
  if (files === null) return { kind: "gone", revision };

  return { kind: "ready", files, revision, createdAt: entry.createdAt };
}
