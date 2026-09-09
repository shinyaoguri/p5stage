#!/usr/bin/env bash
# 依存を入れる (`npm ci`)。レジストリ側の一時障害だけやり直す (#131)。
#
# **npm 自身の fetch-retries は当てにできない。** npm の取得層がやり直すのは接続の確立に
# 失敗したときで、tarball のボディを読んでいる最中に切られた ECONNRESET
# (`npm error syscall read`) は対象外。実際 #130 の失敗は 21 秒で落ちていて、既定の
# やり直し 2 回 (最短でも 70 秒かかる) が 1 度も使われていなかった。だからステップごとやり直す。
#
# **やり直すのはネットワーク由来の失敗だけ。** package-lock の不整合のように何度試しても
# 同じものまで待つと、赤くなるのが遅れるだけで何も得しない。
set -uo pipefail

# 既定はいずれも CI 向け。テストは実行コマンドと待ち時間を差し替えて振る舞いだけを見る。
attempts="${NPM_CI_ATTEMPTS:-3}"
sleep_unit="${NPM_CI_SLEEP:-15}"
cmd="${NPM_CI_CMD:-npm ci}"

# npm はネットワーク由来のとき必ず `npm error network` を出す。レジストリが 5xx を返した
# ときは HTTP のステータス行しか出ないことがあるので、そちらも拾う。
network_error='npm error network|npm error code (ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ERR_SOCKET_TIMEOUT)|npm error 5[0-9][0-9] '

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

attempt=1
while :; do
  # cmd は「コマンドと引数」なので、意図して単語分割させる。
  # shellcheck disable=SC2086
  if $cmd 2>&1 | tee "$log"; then
    exit 0
  fi

  if ! grep -qE "$network_error" "$log"; then
    echo "::error::npm ci が失敗しました (ネットワーク由来ではないのでやり直しません)"
    exit 1
  fi

  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::npm ci が ${attempts} 回ともネットワークの問題で失敗しました"
    exit 1
  fi

  wait_sec=$((sleep_unit * attempt))
  echo "::warning::npm ci がネットワークの問題で失敗しました。${wait_sec} 秒後にやり直します (${attempt}/${attempts} 回目)"
  [ "$wait_sec" -gt 0 ] && sleep "$wait_sec"
  attempt=$((attempt + 1))
done
