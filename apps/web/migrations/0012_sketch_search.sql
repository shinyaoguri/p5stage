-- 作品の検索索引 (Phase 5 / ADR 0020)。
--
-- 発見の 4 本目の線。トップページが「今」、ユーザーページが「誰」、タグが「何に
-- ついて」で、ここが**言葉から引く**道を担う。
--
-- 探すのはタイトル・説明・タグの 3 つ。コードの中身は入れない (正本は Gist で、
-- D1 には無い — ADR 0002)。
--
-- **tokenize は trigram**。既定の unicode61 は空白で語を割るので、**日本語の
-- 文が丸ごと 1 語になり部分一致がまったく効かない**。trigram は 3 文字の窓で
-- 索引を作るため、語の切れ目を知らなくても引ける (代わりに 2 文字以下の語では
-- 引けない — その足切りは lib/sketches/search.ts が持つ)。
CREATE VIRTUAL TABLE sketch_search USING fts5(
  -- 引き当てた行から作品へ戻るための鍵。**索引には入れない** (UNINDEXED) —
  -- ID の断片が検索語に当たっても、利用者にとって意味のある一致ではない。
  sketch_id UNINDEXED,
  title,
  description,
  -- 作品に付いた全タグを空白で連ねたもの。タグに空白は入らない
  -- (`normalizeTag` が `-` へ畳む) ので、連ねても語の境界は壊れない。
  tags,
  tokenize = 'trigram'
);

-- 既にある作品を索引へ。索引を後から足す以上、ここを忘れると
-- 「この移行より前の作品だけ検索に出ない」という気付きにくい穴が空く。
INSERT INTO sketch_search (rowid, sketch_id, title, description, tags)
SELECT s.rowid, s.id, s.title, s.description,
       COALESCE(
         (SELECT group_concat(t.tag, ' ') FROM sketch_tags t
           WHERE t.sketch_id = s.id),
         ''
       )
  FROM sketches s;

-- 同期はトリガーで持つ。**アプリ側から呼ぶ形にしない** — 作品に触る口は
-- 作成・更新・フォーク・取り込み・切り離しと既に多く、1 つでも呼び忘れると
-- 「保存したのに検索に出ない」が起きる。所有の確認を SQL の中でやるのと同じ理由
-- (lib/sketches/store.ts)。
--
-- 引くのは rowid (= `sketches` の rowid)。UNINDEXED 列を条件にすると FTS5 は
-- 索引を使えず全行を復元するので、保存のたびに表全体を読むことになる。
CREATE TRIGGER sketches_search_insert AFTER INSERT ON sketches BEGIN
  -- 先に同じ作品の行を落とす。`INSERT OR REPLACE` で入れ直された作品は
  -- **新しい rowid を採る**ので、消さないと同じ作品が索引に 2 行並ぶ
  -- (E2E の種がこの形で入れ直す)。作品の新規作成は稀な操作なので、
  -- ここだけ全走査でも割に合う。
  DELETE FROM sketch_search WHERE sketch_id = new.id;
  INSERT INTO sketch_search (rowid, sketch_id, title, description, tags)
  VALUES (new.rowid, new.id, new.title, new.description, '');
END;

-- 公開範囲は索引に持たせない (絞りは検索時に `sketches` 側でやる) ので、
-- ここで拾うのは題と説明が変わったときだけ。
CREATE TRIGGER sketches_search_update
AFTER UPDATE OF title, description ON sketches BEGIN
  UPDATE sketch_search
     SET title = new.title, description = new.description
   WHERE rowid = new.rowid;
END;

CREATE TRIGGER sketches_search_delete AFTER DELETE ON sketches BEGIN
  DELETE FROM sketch_search WHERE rowid = old.rowid;
END;

-- タグは別表なので、付け外しのたびに連結し直す。`replaceTags` は全置換
-- (消してから入れ直す) なので、消す側と足す側の両方から呼ばれる。
CREATE TRIGGER sketch_tags_search_insert AFTER INSERT ON sketch_tags BEGIN
  UPDATE sketch_search
     SET tags = COALESCE(
           (SELECT group_concat(t.tag, ' ') FROM sketch_tags t
             WHERE t.sketch_id = new.sketch_id),
           ''
         )
   WHERE rowid = (SELECT rowid FROM sketches WHERE id = new.sketch_id);
END;

CREATE TRIGGER sketch_tags_search_delete AFTER DELETE ON sketch_tags BEGIN
  UPDATE sketch_search
     SET tags = COALESCE(
           (SELECT group_concat(t.tag, ' ') FROM sketch_tags t
             WHERE t.sketch_id = old.sketch_id),
           ''
         )
   WHERE rowid = (SELECT rowid FROM sketches WHERE id = old.sketch_id);
END;
