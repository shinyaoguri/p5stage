/**
 * 利用者の公開プロフィールの読み取り (D1)。
 *
 * users への書き込み (ログイン時の upsert) はセッションの関心なので
 * `lib/session/store.ts` が持つ。こちらは**ログイン不要で誰でも見る側** —
 * ユーザーページ (Phase 5) が login から作者を引くための口。
 */

/** 外に出してよいユーザーの情報。トークンもセッションも混ぜない。 */
export interface PublicUser {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string | null;
}

interface UserRow {
  readonly id: number;
  readonly login: string;
  readonly avatar_url: string | null;
}

/**
 * login からユーザーを引く。見つからなければ null。
 *
 * GitHub の login は大文字小文字を区別しないので `COLLATE NOCASE` で引く
 * (0010 の索引も同じ照合順序)。呼び出し側は返ってきた `login` と URL の綴りを
 * 比べ、違えば正典へ 302 する — 同じ人に複数の URL を持たせないため。
 *
 * **複数ヒットがありうる**。login は改名で変わり、D1 がそれを知るのは本人が次に
 * ログインしたときなので、古い login を持ったままの行と、その login を新たに取った
 * 人の行が並ぶ時間帯がある (0010)。そのときは**最後にログインした方**を選ぶ。
 * 今その名前で GitHub にいる人の方が、訪問者の探している相手である見込みが高い。
 */
export async function getUserByLogin(
  db: D1Database,
  login: string
): Promise<PublicUser | null> {
  const row = await db
    .prepare(
      `SELECT id, login, avatar_url FROM users
        WHERE login = ? COLLATE NOCASE
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .bind(login)
    .first<UserRow>();

  if (row === null) return null;
  return { id: row.id, login: row.login, avatarUrl: row.avatar_url };
}
