/**
 * 「版が進んだ」を同期チャネルへ伝える (Phase 4-2 / ADR 0017)。
 *
 * 呼ぶのは `publishRevision` の 1 か所だけ。4-1 の時点では進行点が 3 か所
 * (保存・閲覧時の埋め合わせ・再検証) に散っていたので、通知を足す前にそちらを
 * 寄せてある。
 */

import { env, waitUntil } from "cloudflare:workers";

/**
 * 配信するリビジョンが進んだことを、その作品を開いている閲覧者へ知らせる。
 *
 * **待たない。** 正本 (Gist) にも R2 にも既に書けているので、知らせが届いたかどうかは
 * 保存の成否と関係が無い。ここで待つと、閲覧者が 1 人もいない作品の保存まで
 * DO への往復ぶん遅くなる。
 *
 * 失敗も握り潰す。届かなかった閲覧者は、次の再接続で現在の版を引き直して追いつく
 * (`/api/sketches/:id/head`)。**知らせは取りこぼしても回復する経路がある**ことが、
 * ここを「落ちてもよい仕事」にしている。
 */
export function notifyRevision(sketchId: string, revision: string): void {
  waitUntil(deliver(sketchId, revision));
}

async function deliver(sketchId: string, revision: string): Promise<void> {
  try {
    const channel = env.SKETCH_CHANNEL;
    await channel.get(channel.idFromName(sketchId)).publish(revision);
  } catch {
    // 上記のとおり、届かないことは保存の失敗ではない。
  }
}
