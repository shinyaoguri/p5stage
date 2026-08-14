/**
 * 配信用の中身の置き場 (R2)。
 *
 * キーに**リビジョン SHA を含めるので、書いたオブジェクトは二度と変わらない**。
 * 「古くなった複製」という状態が生まれないため、無効化の仕組みが要らない。
 * 過去リビジョンの再現 (要件 3.2) も、キーを変えるだけで同じ仕組みに乗る。
 *
 * ここに入るのは正本ではなく配信のための写し (ADR 0011)。失っても Gist から
 * 取り直せるので、読めなければ null を返して呼び出し側に埋め直させる。
 */

import { parseSketchFiles, type SketchFiles } from "@p5stage/shared";

/** 1 リビジョンのキー。gist の ID とリビジョンの組で一意になる。 */
export function revisionKey(gistId: string, revision: string): string {
  return `gists/${gistId}/${revision}.json`;
}

/** キーの前置き。走査 (3-5b のバックフィル) はこの下だけを見る。 */
export const REVISION_KEY_PREFIX = "gists/";

/**
 * キーから `(gistId, revision)` を取り出す。形が違えば null (3-5b)。
 *
 * バックフィルは**書いた側の記録が無い**リビジョンを R2 から拾い直すので、キーが
 * 唯一の手掛かりになる。`revisionKey` の逆で、両者がずれていないことは単体テストが
 * 往復で確かめる。
 *
 * 想定外のキーを黙って捨てず null で返すのは、呼び出し側が「読めなかった数」を
 * 数えられるようにするため (勝手な形のオブジェクトが混ざっていることに気付ける)。
 */
export function parseRevisionKey(
  key: string
): { readonly gistId: string; readonly revision: string } | null {
  if (!key.startsWith(REVISION_KEY_PREFIX) || !key.endsWith(".json")) {
    return null;
  }

  const middle = key.slice(REVISION_KEY_PREFIX.length, -".json".length);
  const parts = middle.split("/");
  if (parts.length !== 2) return null;

  const [gistId, revision] = parts;
  if (!gistId || !revision) return null;

  return { gistId, revision };
}

/** 中身を書く。同じキーへの書き込みは同じ内容になるので、上書きを気にしない。 */
export async function putRevision(
  bucket: R2Bucket,
  gistId: string,
  revision: string,
  files: SketchFiles
): Promise<void> {
  await bucket.put(revisionKey(gistId, revision), JSON.stringify(files), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

/**
 * 中身を読む。無い・壊れているなら null。
 *
 * 壊れていた場合に例外を投げないのは、**呼び出し側の次の一手が「無い」ときと
 * 同じ** (GitHub から取り直して埋める) ため。
 */
export async function getRevision(
  bucket: R2Bucket,
  gistId: string,
  revision: string
): Promise<SketchFiles | null> {
  const object = await bucket.get(revisionKey(gistId, revision));
  if (object === null) return null;

  try {
    return parseSketchFiles(JSON.parse(await object.text()));
  } catch {
    return null;
  }
}
