-- 作品 (スケッチ) のメタデータ (Phase 2-2)。
--
-- コードそのものは作者自身の Gist が正本で、ここには置かない (ADR 0002)。
-- D1 が持つのは「Gist だけでは表現できないもの」— 一覧・公開範囲・所有者 — に限る。

CREATE TABLE sketches (
  -- URL に出る ID。連番にすると他人の作品を数えられるので乱数にする。
  -- 限定公開は「URL を知る人は見られる」= ID の推測困難性がそのまま防御になる。
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  -- Gist の ID。器だけ作って中身をまだ書き出していない間は NULL。
  -- 1 作品 1 Gist なので UNIQUE (SQLite の UNIQUE は NULL を重複と見なさない)。
  gist_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- public = 公開 Gist、unlisted = secret gist (要件 3.4)。
  -- **private ではない**。真の非公開は要件から外してある。
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- 作者ページ (Phase 5) と、編集画面の「自分の作品」で引く。
CREATE INDEX sketches_owner ON sketches (owner_id, updated_at DESC);
-- 新着ギャラリー (Phase 5)。限定公開を混ぜないよう visibility を先頭に置く。
CREATE INDEX sketches_public ON sketches (visibility, updated_at DESC);
