-- E2E 用の作品 (Phase 2-4)。
--
-- 作品を作るには GitHub の認可が要り、E2E では踏めない。作品ページの表示・
-- 正典 URL への 302・キャッシュヘッダ・別オリジンでの実行は**作品が 1 件でも
-- 無いと確かめられない**ので、ここで直に置く。
--
-- 中身 (R2) は e2e/seed-content.json を同じキーで置く (playwright.config.ts)。
-- `revision_checked_at` を今にしておくと再検証の間隔に入らないので、
-- テスト中に GitHub へ出ていかない。

INSERT OR REPLACE INTO users (id, login, avatar_url, created_at, updated_at)
VALUES (424242, 'e2e-author', NULL, 0, 0);

-- 公開。作品ページの本体を見るのはこちら。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EPublicSketch0', 424242, 'e2e-gist-public', 'E2E 公開スケッチ',
   'E2E のための作品です。', 'public',
   0, 0, 'e2erev01', '"e2e"', unixepoch() * 1000, NULL);

-- 限定公開。共有キャッシュに載らないこと・注意書き・noindex を見る。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EUnlistedSkt01', 424242, 'e2e-gist-unlisted', 'E2E 限定公開スケッチ',
   '', 'unlisted',
   0, 0, 'e2erev01', '"e2e"', unixepoch() * 1000, NULL);
