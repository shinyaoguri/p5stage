-- 閲覧配信のためのポインタ (Phase 2-4)。
--
-- 中身の正本は変わらず作者自身の Gist (ADR 0002)。配信に使うのは R2 に置いた
-- **リビジョン SHA をキーにした不変オブジェクト**で、D1 が持つのは「今どれを配るか」
-- だけ。こうすると閲覧経路が D1 → R2 で閉じ、GitHub のレート制限
-- (OAuth App あたり 5,000 回/時) が閲覧数と無関係になる (ADR 0011)。

-- 配信するリビジョン。R2 のキーになる。まだ書き出していない間は NULL。
ALTER TABLE sketches ADD COLUMN current_revision TEXT;

-- 最後に GitHub と突き合わせたときの ETag。
-- 条件付き GET で 304 を貰えばレート制限を消費しない (認証付きの場合)。
ALTER TABLE sketches ADD COLUMN revision_etag TEXT;

-- 最後に突き合わせた時刻。古くなった作品を閲覧したときだけ確かめ直す。
ALTER TABLE sketches ADD COLUMN revision_checked_at INTEGER;

-- 作者が GitHub 側で Gist を消したときに立てる印 (要件 6 の tombstone)。
-- Gist に webhook は無いので、消えたことは閲覧時の再検証でしか分からない。
-- 一度立てたら以後その作品で GitHub を叩かない。
ALTER TABLE sketches ADD COLUMN gist_deleted_at INTEGER;
