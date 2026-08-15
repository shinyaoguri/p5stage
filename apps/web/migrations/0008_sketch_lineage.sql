-- フォークの系譜 (Phase 4-3 / #44 / ADR 0018)。
--
-- 作品を増やす経路は 4 つある (ADR 0012)。実装済みの 2 つ (既存 Gist の続きを編集 /
-- 外部にある自分の Gist の取り込み) に続いて、**他人の作品を持ち込む** (Gist fork API)
-- と**自分の作品から派生を作る** (新規 Gist 作成) がここに載る。
--
-- **系譜の正典は D1 に置く。** GitHub 側の `Forked from` は経路によって付いたり
-- 付かなかったりする (自分の Gist は自分で fork できない — #44) うえ、付いても残るのは
-- Gist 同士の関係だけで、p5stage の作品同士の系譜はそこからは引けない。

-- 派生元の作品。
--
-- **既定値を書かない。** SQLite が外部キー付きの ADD COLUMN を許すのは、既定値が
-- NULL のときに限られる。値を与えるとこの移行自体が実行できない。
--
-- 作品を消す口はまだ無いので、参照は張ったままにできる。消せるようになったときに
-- 「親を消したら子の系譜はどうなるか」を決める必要があるが、根拠になる仕様が
-- まだ無い以上、今ここで ON DELETE の向きを決め打ちしない。
ALTER TABLE sketches ADD COLUMN forked_from_sketch_id TEXT REFERENCES sketches(id);

-- 派生した時点で**親が配っていた** Gist のリビジョン SHA。
--
-- 新しい Gist 自身の SHA ではない。「どの版から分かれたか」は親の側の座標でしか
-- 表せない。`sketches.current_revision` を後から読んで代用することもしない —
-- 作者が GitHub 側で直接編集していれば、実際に複製した版とは違う SHA を刻む
-- (ADR 0016 が「履歴は p5stage が写しを持っている版」と書いたのと同じずれ)。
ALTER TABLE sketches ADD COLUMN forked_from_revision TEXT;

-- 派生の一覧を引く経路 (Phase 5 の系譜表示)。系譜を持つ行は全体のごく一部なので
-- 部分インデックスにする (`blobs_orphaned` と同じ形)。並べ替えの分まで入れておく。
CREATE INDEX sketches_forked_from
  ON sketches (forked_from_sketch_id, updated_at DESC)
  WHERE forked_from_sketch_id IS NOT NULL;
