/**
 * タグの付け替えを正本 (D1) へ送る口 (Phase 5)。
 *
 * タグは Gist に持たせない。GitHub 側に置き場が無い上、あちらに書けば保存の往復が
 * 1 つ増える — 発見のための情報は p5stage が持つ D1 のもの (ADR 0002)。
 *
 * 失敗は投げずに**見せる文言**で返す。呼ぶのはダイアログで、その場に出せる形が
 * 都合よい (`TagsPanel.onSave` の契約)。
 */

/** タグを送る。成功なら null、失敗なら理由。 */
export async function saveSketchTags(
  sketchId: string,
  tags: readonly string[]
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`/api/sketches/${encodeURIComponent(sketchId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
  } catch {
    return "タグを保存できませんでした。接続を確認してください";
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    return body.message ?? `タグを保存できませんでした (${response.status})`;
  }
  return null;
}
