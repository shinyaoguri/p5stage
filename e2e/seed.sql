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

-- アセットを使う作品 (Phase 3-3)。中身は e2e/seed-content-assets.json、
-- 実体 (e2e/fixtures/dot.png) は R2 の p5stage-assets へ同じ sha256 で置く。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EAssetSketch01', 424242, 'e2e-gist-assets', 'E2E アセットスケッチ',
   '', 'public',
   0, 0, 'e2erev01', '"e2e"', unixepoch() * 1000, NULL);

-- 台帳。配信は R2 だけで完結する (ADR 0014) ので配信テストには要らないが、
-- 回収 (3-5b) はこの表を起点に引くので、実体があるなら行も要る。
--
-- **所有は持たせない。** ADR 0003 が「公開済みリビジョンが参照する blob は原則
-- 削除しない」と言っているのは、まさにこの形 — 作った人が作品を残したままアセット
-- だけ手放した状態。参照台帳 (`blob_refs`) にもこの種は行を持たない (種は 3-5a より
-- 前と同じく R2 へ直に置くだけ) ので、**回収前のバックフィルが効かないと孤児と
-- 見なされて消える**。`asset-gc.spec.ts` がそれを見張る。
INSERT OR REPLACE INTO blobs (sha256, size, mime, created_at)
VALUES
  ('7c12c1f9323964065d6b659ec1fe67544707644bf1ce287b9b1c195250adfdfe',
   70, 'image/png', 0);
-- ローカルの D1 は実行をまたいで残るので、以前の種が入れた所有を落としておく。
DELETE FROM user_blobs
 WHERE sha256 = '7c12c1f9323964065d6b659ec1fe67544707644bf1ce287b9b1c195250adfdfe';

-- 限定公開。共有キャッシュに載らないこと・注意書き・noindex を見る。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EUnlistedSkt01', 424242, 'e2e-gist-unlisted', 'E2E 限定公開スケッチ',
   '', 'unlisted',
   0, 0, 'e2erev01', '"e2e"', unixepoch() * 1000, NULL);
