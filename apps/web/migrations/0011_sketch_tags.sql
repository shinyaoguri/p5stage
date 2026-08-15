-- 作品のタグ (Phase 5)。主題で作品どうしをつなぐ発見の線。
--
-- **`sketches` の列にしない。** タグ別の一覧を索引で引けることが正規化する側の要点で、
-- JSON の配列を 1 列に持たせると一覧が LIKE の全表走査になる。ここは検索 (Phase 5 の
-- 次) の絞り込み対象にもなるので、最初から引ける形で置く。
--
-- 値は正規化済みのものだけを入れる (`lib/sketches/tags.ts` の `normalizeTag` —
-- 小文字・空白は畳む・1〜30 文字)。DB 側では長さも文字種も見ない。**照合の規則を
-- SQL と TypeScript の 2 か所に持たせない**ためで、入口 (API) を 1 つに絞って
-- そこで整える方針は title / description と同じ。
CREATE TABLE sketch_tags (
  sketch_id TEXT NOT NULL REFERENCES sketches(id),
  tag TEXT NOT NULL,
  -- 作者が並べた順。作品ページはこの順で出す (付けた順に意味を持たせる作者がいる)。
  position INTEGER NOT NULL,
  -- 同じ作品に同じタグは 1 つ。付け直しは全置換 (`replaceTags`) なので、
  -- ここが競合するのは同じ作品を 2 つの画面から同時に編集したときだけ。
  PRIMARY KEY (sketch_id, tag)
) STRICT;

-- タグ別の一覧 (`/tags/<tag>`)。並び替えは `sketches.updated_at` 側で起きるので、
-- 索引が担うのは「そのタグが付いた作品を集める」ところまで。
CREATE INDEX sketch_tags_tag ON sketch_tags (tag);
