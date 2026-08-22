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

import { unclaimedDigests } from "../assets/store";
import { checkManifest } from "../assets/manifest-check";
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

import { gateManifest, type DeliveryGate } from "./delivery-gate";
import { planDelivery } from "./delivery-plan";
import { publishRevision } from "./publish";
import { findRevision } from "./revision-log";
import { getRevision } from "./revision-store";
import type { Sketch } from "./sketch";
import {
  markDeliveryBlocked,
  markGistDeleted,
  markRevisionChecked,
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

/**
 * GitHub から拾った中身を配信に載せてよいか確かめる (#70)。
 *
 * **保存を経ずに配信へ入る口には、保存と同じ所有の検査が要る。** 作者が
 * gist.github.com で `assets.json` に他人の sha256 を書けば、この 2 経路が閲覧の
 * たびにそれを R2 と参照台帳へ運び、配信 `/a/<sha256>/<name>` は D1 を引かないので
 * 実際に配られる (#65 と同じ結果に別経路から到達する)。ADR 0003 の「補足 (#65)」が
 * **まだ残っている口**と書いた経路がここ。
 *
 * 照会する所有者は**作品の持ち主**で迷いが無い。この中身は作者自身の Gist から
 * 来ていて、その Gist を正本にしているのはこの作品だけ (`gist_id` は UNIQUE)。
 */
async function gateContent(
  sketch: Sketch,
  files: SketchFiles
): Promise<DeliveryGate> {
  const check = checkManifest(files);
  if (check.kind !== "ok") return gateManifest(check, []);

  const unclaimed = await unclaimedDigests(
    env.DB,
    sketch.ownerId,
    check.digests
  );
  return gateManifest(check, unclaimed);
}

/**
 * GitHub から取って R2 とポインタを埋める。
 *
 * 書けたかどうかは見ない。**中身は手元にあるので閲覧者には配れる** — 写しを
 * 残せなかっただけなら、この閲覧を失敗にする理由が無い (次の閲覧がもう一度
 * 埋めにくる)。4-1 までは `storeRevision` の失敗が例外として上がり、配れるのに
 * `unavailable` へ化けていた。
 */
async function fill(sketch: Sketch, gistId: string): Promise<SketchContent> {
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

  // 断るしかない中身しか無い。**配れる正しい版が手元に無い**ので、再検証と違って
  // 前の版へ退がることもできない (`revalidate` は退がる先がある)。
  const gate = await gateContent(sketch, content.files);
  if (gate.kind === "reject") {
    await markDeliveryBlocked(env.DB, sketch.id, content.revision, Date.now());
    return {
      kind: "unavailable",
      reason: "所有していないアセットを参照しています",
    };
  }

  await publishRevision(
    sketch.id,
    gistId,
    content.revision,
    content.files,
    result.etag
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

    // 作者が GitHub 側で直接編集した分。**ここも版が進む経路**なので、保存と
    // 同じ道を通して知らせまで出す (進行点は `publishRevision` の 1 つ)。
    const { content } = result;

    // 所有していない blob を参照していれば**版を進めない** (#70)。閲覧者は直前の
    // 正しい版を見続けるので作品は止まらず、配らない以上その版を参照台帳で守る
    // 理由も無い。作者にはエディタで知らせる (この印がその置き場)。
    const gate = await gateContent(sketch, content.files);
    if (gate.kind === "reject") {
      await markDeliveryBlocked(env.DB, sketch.id, content.revision, now);
      return;
    }

    await publishRevision(
      sketch.id,
      sketch.gistId,
      content.revision,
      content.files,
      result.etag
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

    return await fill(sketch, gistId);
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
