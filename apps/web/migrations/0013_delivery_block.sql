-- 配信が断った版の印 (#70)。
--
-- 配信の再検証 (`lib/sketches/delivery.ts` の `revalidate`) は、作者が GitHub 側で
-- 直接編集した `assets.json` も拾って配信に載せる。所有していない sha256 を指す
-- マニフェストをそのまま載せると、クォータを一切使わずにアセット付きの作品が
-- 配られる (ADR 0003 の「所有で数える」が上限として働かない)。
--
-- 断り方は**版を進めない**。閲覧者は直前の正しい版を見続けるので作品は止まらず、
-- 配られない以上その版を GC から守る必要も無い (3-5a の「配られる実体と同じ単位で
-- 数える」)。ただしそのままだと、作者から見て**GitHub での編集が黙って反映されない**
-- 状態になる。理由を残す先がここ。
--
-- 作品ページには出さない。あのページはエッジキャッシュを閲覧者全員と共有するので、
-- 所有者だけに見せる術が無い。読み手はエディタ (`GET /api/sketches/:id/files` は
-- ログインを要求し、`no-store` で返る)。
--
-- 印が消えるのは配信が進んだとき 1 か所だけ (`publishRevision`)。保存で直しても
-- GitHub 側を直して再検証が通っても、同じ道を通る。
ALTER TABLE sketches ADD COLUMN delivery_blocked_at INTEGER;

-- どの版を断ったか。作者が「反映されていない編集」を特定できるようにする。
ALTER TABLE sketches ADD COLUMN delivery_blocked_revision TEXT;
