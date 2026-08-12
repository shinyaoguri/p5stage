-- ユーザーとセッション (Phase 2-1)。
--
-- セッションは D1 に置く。KV は結果整合性でログアウトの反映が遅れるのに対し、
-- D1 なら失効が即座に効く。Phase 2 でどのみち D1 が要る (作品メタデータ) ので、
-- 依存も増えない。

-- GitHub のユーザー。id は GitHub 側の数値 ID をそのまま使う
-- (login は改名で変わるため主キーにできない)。
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- ログインセッション。
--
-- id には cookie の値そのものではなく **その SHA-256** を入れる。DB が漏れても
-- セッションを乗っ取れないようにするため (パスワードを平文で持たないのと同じ理屈)。
--
-- GitHub のアクセストークンは全 Gist への書き込み権限を持つので、平文では置かない。
-- AES-GCM で封筒に入れ、鍵は Client Secret から HKDF で導出する (ADR 0009)。
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_ciphertext BLOB NOT NULL,
  token_iv BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

-- 期限切れの掃除で使う。
CREATE INDEX sessions_expires_at ON sessions (expires_at);
-- ログアウト時に同じユーザーの他セッションを畳めるようにする。
CREATE INDEX sessions_user_id ON sessions (user_id);
