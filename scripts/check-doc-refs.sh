#!/usr/bin/env bash
# ドキュメントが挙げる参照の実在チェック。リンクの死活は lychee が見るので、
# ここはリンクの形をしていない参照 (ADR 番号・npm script 名) だけを受け持つ。
#
#   1. 本文中の「ADR NNNN」が docs/decisions/NNNN-*.md として実在するか
#   2. CLAUDE.md / README.md が挙げる npm script が package.json に実在するか
#
# 参照が壊れるのは参照先を消したり番号を振り直したときで、PR 単体の diff には
# 現れないことが多い。定期実行で拾う。
set -euo pipefail

cd "$(dirname "$0")/.."
fail=0

echo "== ADR 参照の実在チェック"
# 追跡されていても作業ツリーに無いファイル (削除直後など) は除く
docs=()
while IFS= read -r f; do
  [ -f "$f" ] && docs+=("$f")
done < <(git ls-files '*.md')
adr_refs=$(grep -hoE 'ADR [0-9]{4}' "${docs[@]}" | grep -oE '[0-9]{4}' | sort -u)
for n in $adr_refs; do
  if ! ls "docs/decisions/${n}-"*.md >/dev/null 2>&1; then
    echo "NG: ADR ${n} を参照しているが docs/decisions/${n}-*.md が無い" >&2
    grep -lE "ADR ${n}" "${docs[@]}" | sed 's/^/    参照元: /' >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "OK: ADR 参照 $(echo "$adr_refs" | wc -w | tr -d ' ') 件すべて実在"

echo "== ドキュメントが挙げる npm script の実在チェック"
scripts_json=$(node -e 'process.stdout.write(Object.keys(require("./package.json").scripts).join("\n"))')
# ```bash ブロックの中の `npm run <name>` / `npm test` を拾う
named=$(grep -hoE '\bnpm run [a-z0-9:-]+' CLAUDE.md README.md | sed 's/^npm run //' | sort -u)
for s in $named; do
  if ! printf '%s\n' "$scripts_json" | grep -qx "$s"; then
    echo "NG: ドキュメントが npm run ${s} を挙げているが package.json の scripts に無い" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "OK: npm script 参照 $(echo "$named" | wc -w | tr -d ' ') 件すべて実在"

exit "$fail"
