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
