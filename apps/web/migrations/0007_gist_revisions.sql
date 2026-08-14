-- リビジョンの台帳 (Phase 4-1 / ADR 0016)。
--
-- 配信する版は `sketches.current_revision` が 1 点だけ持つ。R2 には
-- `gists/<gist_id>/<revision>.json` が版ごとに積み上がり、`getRevision` は最初から
-- 任意の版を引ける (ADR 0011) が、**どの版が存在するかを列挙する手段が D1 に無い**。
-- 過去リビジョンの閲覧 (要件 3.2) が引ける形をここで作る。
--
-- 主体は作品ではなく **Gist**。配られる実体 (R2 のキー) と同じ単位で数える。
-- `blob_refs` が同じ理由で `(gist_id, revision)` を選んでおり、この 2 つは兄弟になる
-- (あちらは「アセットを参照する版」だけの部分集合、こちらがその全体)。
--
-- 作品を主体にすると切り離し (detach) が効かなくなる。`detachGist` は `gist_id` を
-- 落として作品ページを「まだ保存されていません」に戻すが、R2 の写しは残るので、
-- 作品を鍵にした履歴からは旧 Gist の中身を配り続けられてしまう (ADR 0012)。

CREATE TABLE gist_revisions (
  -- `sketches` への外部キーは張らない。**この表が数えるのは作品ではなく写し**で、
  -- 切り離しや取り込みで作品との対応は変わる。作品から引くときは
  -- `sketches.gist_id` を経由する (そのとき NULL なら履歴も無い、が正しい)。
  gist_id TEXT NOT NULL,
  -- Gist のリビジョン SHA。R2 のキーと同じ組で不変。
  revision TEXT NOT NULL,
  -- **p5stage が写しを持った時刻**であって、GitHub のコミット時刻ではない
  -- (ADR 0016)。作者が GitHub 側で直接編集した分は、再検証で気付いた時刻になる。
  created_at INTEGER NOT NULL,
  -- 同じ版を二度書き出しても行は増えない (保存の再試行・閲覧時の埋め合わせ・再検証)。
  PRIMARY KEY (gist_id, revision)
) STRICT;

-- 履歴は新しい順に出す。主キーだけでも Gist では絞れるが、並べ替えのために持つ。
CREATE INDEX gist_revisions_recent ON gist_revisions (gist_id, created_at DESC);
