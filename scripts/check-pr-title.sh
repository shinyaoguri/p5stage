#!/usr/bin/env bash
# PR タイトルの Conventional Commits lint。squash merge ではタイトルがそのまま
# main のコミットメッセージになるため、マージ前に形式を強制する。
# 環境変数 PR_TITLE を検査する。
set -euo pipefail

title="${PR_TITLE:?PR_TITLE が未設定}"
# style と revert は使わない (整形のみは chore、revert は打ち消す側の type を名乗る)。
re='^(feat|fix|docs|refactor|test|chore|ci|perf|build)(\([a-z0-9,/-]+\))?!?: .+'

if [[ "$title" =~ $re ]]; then
  echo "OK: pr-title「${title}」"
else
  echo "NG: PR タイトル「${title}」が Conventional Commits 形式でない" >&2
  echo "    <type>(<scope>): <要約> の形で書く" >&2
  echo "    type は feat / fix / docs / refactor / test / chore / ci / perf / build" >&2
  exit 1
fi
