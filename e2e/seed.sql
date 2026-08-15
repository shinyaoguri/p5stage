-- E2E 用の作品 (Phase 2-4)。
--
-- 作品を作るには GitHub の認可が要り、E2E では踏めない。作品ページの表示・
-- 正典 URL への 302・キャッシュヘッダ・別オリジンでの実行は**作品が 1 件でも
-- 無いと確かめられない**ので、ここで直に置く。
--
-- 中身 (R2) は e2e/seed-content.json を同じキーで置く (playwright.config.ts)。
-- `revision_checked_at` を今にしておくと再検証の間隔に入らないので、
-- テスト中に GitHub へ出ていかない。
--
-- リビジョンは**本物と同じ 16 進 40 桁**にしてある (偽 GitHub が返す形も同じ)。
-- 作品ページの `?rev=` は形で足切りするので、種だけ現実と違う形にしておくと
-- 「テストでは通るが本番では弾かれる」経路ができる (Phase 4-1)。
-- 公開の種の gist_id も同じ理由で 16 進 (サムネイル配信 `/t/` が `isGistId` で
-- 足切りする — Phase 5)。他の種の gist_id はまだ `e2e-gist-*` のままで、
-- 揃える作業は別途 (該当の配信経路を踏むテストが無いため)。

INSERT OR REPLACE INTO users (id, login, avatar_url, created_at, updated_at)
VALUES (424242, 'e2e-author', NULL, 0, 0);

-- 公開。作品ページの本体を見るのはこちら。トップページの新着一覧 (Phase 5) にも
-- この種が出る。時刻を今にしてあるのはそのため — 一覧は `updated_at DESC` で
-- 24 件に切るので、1970 年のままだと並列の spec が保存する作品に押し出されうる。
-- `thumbnail_revision` は新着カードの絵 (Phase 4-4 の仕組みを Phase 5 が使う)。
-- 実体は playwright.config.ts が `thumbs/` へ同じキーで置く。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at, thumbnail_revision)
VALUES
  ('E2EPublicSketch0', 424242, 'e2e10000000000000000000000000001', 'E2E 公開スケッチ',
   'E2E のための作品です。', 'public',
   unixepoch() * 1000, unixepoch() * 1000,
   'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, NULL,
   'e2e1111111111111111111111111111111111111');

-- アセットを使う作品 (Phase 3-3)。中身は e2e/seed-content-assets.json、
-- 実体 (e2e/fixtures/dot.png) は R2 の p5stage-assets へ同じ sha256 で置く。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EAssetSketch01', 424242, 'e2e-gist-assets', 'E2E アセットスケッチ',
   '', 'public',
   0, 0, 'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, NULL);

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
   70, 'image/png', 0),
  -- 旧版だけが参照する実体 (Phase 4-1)。今の版から外れても、過去の版が使っている
  -- 限り回収されない — それが「リビジョン = コード + アセットの完全なスナップ
  -- ショット」(ADR 0003) の意味。
  ('7d7e41d5f4c76f3e3fd8d8c0793726ed5d7d0e40d91207d94a95fd28dd1b5c91',
   72, 'image/png', 0);
-- ローカルの D1 は実行をまたいで残るので、以前の種が入れた所有を落としておく。
DELETE FROM user_blobs
 WHERE sha256 IN (
   '7c12c1f9323964065d6b659ec1fe67544707644bf1ce287b9b1c195250adfdfe',
   '7d7e41d5f4c76f3e3fd8d8c0793726ed5d7d0e40d91207d94a95fd28dd1b5c91'
 );

-- 旧版が参照している実体は、**参照台帳に載っている状態**を種で作る (Phase 4-1)。
--
-- 上の赤い方 (今の版が使う実体) は「台帳に無いところからバックフィルが埋める」道を
-- `asset-gc.spec.ts` が見張っているので、あえて行を持たせていない。緑の方まで同じに
-- すると、**参照台帳のバックフィルが済んでいる環境** (カーソルが `done` のまま残る
-- ローカル) で回収に消され、過去の版のアセットが引けなくなる。守られていること自体は
-- 3-5b の担当なので、こちらは前提として置く。
INSERT OR REPLACE INTO blob_refs (gist_id, revision, sha256, created_at)
VALUES
  ('e2e-gist-assets', 'e2e0000000000000000000000000000000000000',
   '7d7e41d5f4c76f3e3fd8d8c0793726ed5d7d0e40d91207d94a95fd28dd1b5c91', 0);

-- 限定公開。共有キャッシュに載らないこと・注意書き・noindex を見る。
-- 新着一覧には**出ない**ことも見る。時刻を今にするのは公開の種と同じ理由で、
-- こちらは「LIMIT の外に落ちたから出なかった」という偽陰性を防ぐため。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EUnlistedSkt01', 424242, 'e2e-gist-unlisted', 'E2E 限定公開スケッチ',
   '', 'unlisted',
   unixepoch() * 1000, unixepoch() * 1000,
   'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, NULL);

-- タグ (Phase 5)。公開の種に 2 つ、限定公開の種にも同じタグを 1 つ付ける。
--
-- **限定公開にも付けるのが肝**で、タグ別一覧 (`/tags/e2e-tag`) に公開の種だけが
-- 出ることを確かめる材料になる (出ない理由がタグの有無ではなく公開範囲であること)。
-- 実行のたびに同じ状態から始めるため、先に落としてから入れる (ローカルの D1 は
-- 実行をまたいで残る。付け替えのテストが最後に置いた値もここで消える)。
DELETE FROM sketch_tags
 WHERE sketch_id IN ('E2EPublicSketch0', 'E2EUnlistedSkt01');
INSERT INTO sketch_tags (sketch_id, tag, position)
VALUES
  ('E2EPublicSketch0', 'e2e-tag', 0),
  ('E2EPublicSketch0', 'e2e-別のタグ', 1),
  ('E2EUnlistedSkt01', 'e2e-tag', 0);

-- 新着一覧 (Phase 5) に出ない側の残り 2 状態。開いても中身が出ない作品は
-- 一覧に見せない (`listPublicSketches`) — 未保存はまだ Gist へ書き出していない器、
-- tombstone は元の Gist が GitHub 側で消された印付き (要件 6)。
-- どちらも公開 (visibility='public') にしてあるのが肝で、除外の理由が
-- 公開範囲ではないことを確かめる。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EUnsavedSkt001', 424242, NULL, 'E2E 未保存スケッチ', '', 'public',
   unixepoch() * 1000, unixepoch() * 1000, NULL, NULL, NULL, NULL),
  ('E2ETombstoneSk01', 424242, 'e2e-gist-tombstone', 'E2E 削除済みスケッチ',
   '', 'public',
   unixepoch() * 1000, unixepoch() * 1000,
   'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, unixepoch() * 1000);

-- リビジョンの台帳 (Phase 4-1)。**中身 (R2) を置いた版だけ**を載せる — 履歴に並ぶ
-- 版は開けることが前提 (ADR 0016)。公開作品とアセット作品には旧版があり、
-- `?rev=` で当時のコードと当時のアセットを引ける。
-- 時刻は「1 日前に旧版、1 時間前に今の版」。固定値にすると 1970 年として出て、
-- 画面の確認や PR の証跡で**何を見ているのか読めなくなる**。
INSERT OR REPLACE INTO gist_revisions (gist_id, revision, created_at)
VALUES
  ('e2e10000000000000000000000000001', 'e2e0000000000000000000000000000000000000',
   (unixepoch() - 86400) * 1000),
  ('e2e10000000000000000000000000001', 'e2e1111111111111111111111111111111111111',
   (unixepoch() - 3600) * 1000),
  ('e2e-gist-assets', 'e2e0000000000000000000000000000000000000',
   (unixepoch() - 86400) * 1000),
  ('e2e-gist-assets', 'e2e1111111111111111111111111111111111111',
   (unixepoch() - 3600) * 1000),
  ('e2e-gist-unlisted', 'e2e0000000000000000000000000000000000000',
   (unixepoch() - 86400) * 1000),
  ('e2e-gist-unlisted', 'e2e1111111111111111111111111111111111111',
   (unixepoch() - 3600) * 1000);

-- 4-1 以前の種が置いていた版 (`e2erev01`) を落とす。ローカルの D1 と R2 は実行を
-- またいで残り、**埋め直しが古い写しを拾って履歴に混ざる**。形も本物と違うので
-- (16 進 40 桁ではない)、残っていると画面の確認が読みにくくなる。
DELETE FROM gist_revisions WHERE revision = 'e2erev01';

-- 4-1 より前に書き出された作品 (Phase 4-1)。**台帳をあえて持たせない。**
--
-- 履歴は Cron が R2 の写しから埋め直す (`revision-backfill.ts`)。それが実際に効く
-- ことを確かめられるよう、種は「写しはあるが台帳に無い」形をここで作る。
-- 他の作品と分けてあるのは、埋まる前は `?rev=` が 404 になり、**並行して走る
-- 他のテストを巻き込む**ため。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at)
VALUES
  ('E2EBackfillSkt01', 424242, 'e2e-gist-backfill', 'E2E 埋め直しスケッチ',
   '', 'public',
   0, 0, 'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, NULL);

-- 台帳とカーソルを落として、実行のたびに同じ状態から始める
-- (ローカルの D1 は実行をまたいで残る)。
DELETE FROM gist_revisions WHERE gist_id = 'e2e-gist-backfill';
DELETE FROM gc_state WHERE key = 'revisions_backfill_cursor';

-- フォークの相手 (Phase 4-3)。
--
-- **偽 GitHub 側にも実体がある**唯一の種にしてある (`fake-github/server.ts` が
-- 同じ `gist_id` で登録する)。他の種は GitHub 側に無いことを前提にしたテストが
-- あるので、フォークのためだけの作品を分けて置く。
--
-- 作者は他の種と同じ 424242 で、**ログインする利用者とは別人**。それが
-- 「自分の Gist は自分で fork できない」(#44) を踏まない条件になる。
INSERT OR REPLACE INTO sketches
  (id, owner_id, gist_id, title, description, visibility,
   created_at, updated_at, current_revision, revision_etag,
   revision_checked_at, gist_deleted_at,
   forked_from_sketch_id, forked_from_revision)
VALUES
  ('E2EForeignSkt001', 424242, 'e2e-gist-foreign', 'E2E 他人のスケッチ',
   'フォークされる側の作品です。', 'public',
   0, 0, 'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, NULL, NULL, NULL),
  -- 限定公開の親。**系譜の表示で URL を漏らさない**ことを確かめる側 (ADR 0018)。
  ('E2EForeignUnl001', 424242, 'e2e-gist-foreign-unlisted',
   'E2E 他人の限定公開スケッチ', '', 'unlisted',
   0, 0, 'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, NULL, NULL, NULL),
  -- アセットを使う親。**他人の blob が自分に計上されるか**を見る側 (ADR 0003)。
  -- 参照する実体は上で置いた dot.png で、所有は誰も持っていない状態から始まる。
  ('E2EForeignAst001', 424242, 'e2e-gist-foreign-assets',
   'E2E 他人のアセット作品', '', 'public',
   0, 0, 'e2e1111111111111111111111111111111111111', '"e2e"',
   unixepoch() * 1000, NULL, NULL, NULL);

INSERT OR REPLACE INTO gist_revisions (gist_id, revision, created_at)
VALUES
  ('e2e-gist-foreign', 'e2e1111111111111111111111111111111111111',
   (unixepoch() - 3600) * 1000),
  ('e2e-gist-foreign-unlisted', 'e2e1111111111111111111111111111111111111',
   (unixepoch() - 3600) * 1000),
  ('e2e-gist-foreign-assets', 'e2e1111111111111111111111111111111111111',
   (unixepoch() - 3600) * 1000);

-- 前回の実行で作られたフォーク (と、その作者の計上) を落として、毎回同じ状態から
-- 始める。**フォークは冪等ではない**ので、残しておくと実行のたびに積み上がる。
DELETE FROM sketches
 WHERE forked_from_sketch_id IN
   ('E2EForeignSkt001', 'E2EForeignUnl001', 'E2EForeignAst001');

-- タグ付けのテスト (e2e/tags.spec.ts) が保存した作品も同じ理由で落とす。あちらは
-- **自分で付けたタグで一覧を引く**ので、前回の作品が残っていると同じ名前の
-- カードが 2 枚並び、掴めなくなる。タグの行を先に落とす (作品を参照している)。
DELETE FROM sketch_tags
 WHERE sketch_id IN (SELECT id FROM sketches WHERE title LIKE 'E2E タグ%');
DELETE FROM sketches WHERE title LIKE 'E2E タグ%';

-- 検索のテスト (e2e/search.spec.ts) が保存した作品も落とす。あちらは実行ごとに
-- 違う語を含む名前を付けるので取り違えは起きないが、**残すと検索の索引に
-- 積み上がる**。索引側の行は `sketches` を消せばトリガーが落とす
-- (migrations/0012) ので、ここで触るのは作品の表だけでよい。
DELETE FROM sketches WHERE title LIKE 'E2E 検索%';
