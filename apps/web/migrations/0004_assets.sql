-- アセットの台帳 (Phase 3-1)。
--
-- 実体は R2 に置く sha256 キーの不変 blob で、ここには置かない (ADR 0003)。
-- D1 が持つのは「その blob が存在すること」と「誰に計上するか」— つまり
-- **R2 を数え直さずに答えられるようにするための帳簿**。p5.js Web Editor が
-- 台帳を持たず S3 の実測でクォータを計算してズレを抱えている所を、ここで避ける。

-- blob の実体 1 つ 1 つ。キーは中身から決まるので、同じ中身は必ず同じ行になる。
CREATE TABLE blobs (
  -- 小文字 16 進の sha256。R2 のキーと同じ値で、これが content-addressed の要。
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  -- 受け付けた形式 (allowlist 済み)。同じ中身に 2 つの形式を持たせないため、
  -- 最初に受け付けたときの値を以後も使う。
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

-- 誰に計上するか。**参照ではなく所有**を持つ。
--
-- ADR 0003 は「参照 blob の合計を各ユーザーに満額計上する」と書いているが、
-- アップロードした直後の blob はまだどのリビジョンからも参照されていない。
-- 参照だけで数えると「参照しないまま上げ続ける」が無料になってしまうので、
-- 持ち込んだ時点で計上する。フォークで他人の blob を持ち込む場合 (Phase 4) も
-- ここに行が増える形にすれば、計上の規則は 1 つで済む。
CREATE TABLE user_blobs (
  user_id INTEGER NOT NULL REFERENCES users(id),
  sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  created_at INTEGER NOT NULL,
  -- 同じ人が同じ blob を 2 回持ち込んでも 1 回しか数えない。
  PRIMARY KEY (user_id, sha256)
) STRICT;

-- 「自分のアセット」を新しい順に引く (管理 UI は 3-4)。
-- 主キーだけでも user_id で絞れるが、並べ替えのために created_at を持つ。
CREATE INDEX user_blobs_recent ON user_blobs (user_id, created_at DESC);

-- クォータは**ユーザー単位の設定値**として持つ (要件 3.3)。
-- 定数で持つと、有料プランで引き上げるときにテーブル定義から作り直しになる。
-- 既定値は無料の初期値で、packages/shared の DEFAULT_ASSET_QUOTA_BYTES (250MB) /
-- DEFAULT_MAX_ASSET_BYTES (5MB) と同じ値。
ALTER TABLE users ADD COLUMN asset_quota_bytes INTEGER NOT NULL DEFAULT 262144000;
ALTER TABLE users ADD COLUMN max_asset_bytes INTEGER NOT NULL DEFAULT 5242880;
