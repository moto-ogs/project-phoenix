#!/usr/bin/env bash
# A depth-1 checkout of a pull request must end with full ancestry and with
# every file of the commits the backend tests compare against, without the
# blobs of the rest of the history.
set -euo pipefail
repo_root=$(git rev-parse --show-toplevel)
fetch="$repo_root/scripts/fetch-comparison-history.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

fail() { echo "FAIL: $*" >&2; exit 1; }
missing() { git -C "$1" rev-list --objects --missing=print --no-walk "$2" | grep -c '^?' || true; }

origin="$fixture/origin"
git init -q -b development "$origin"
git -C "$origin" config uploadpack.allowFilter true
git -C "$origin" config uploadpack.allowAnySHA1InWant true
commit() { # <file> <content> <message>
  printf '%s\n' "$2" >"$origin/$1"
  git -C "$origin" add "$1"
  git -C "$origin" commit -q -m "$3"
}
commit old.txt 'only in old history' 'old'
git -C "$origin" rm -q old.txt
commit policy.json 'base policy' 'base'
base=$(git -C "$origin" rev-parse HEAD)
git -C "$origin" checkout -q -b stack-base
commit stack.txt 'stack base' 'stack base'
commit stack.txt 'stack tip' 'stack tip'
stack_tip=$(git -C "$origin" rev-parse HEAD)
git -C "$origin" checkout -q -b feature
commit policy.json 'feature policy' 'feature'
git -C "$origin" checkout -q development
commit policy.json 'newer development policy' 'development moves on'
development_tip=$(git -C "$origin" rev-parse HEAD)

checkout() { # <dir>: what actions/checkout leaves with fetch-depth 1
  git clone -q --depth=1 --no-tags --single-branch -b feature "file://$origin" "$1"
}

checkout "$fixture/pr"
(cd "$fixture/pr" && "$fetch" >/dev/null 2>&1)
[ "$(git -C "$fixture/pr" rev-parse --is-shallow-repository)" = false ] || fail "history is still shallow"
[ "$(git -C "$fixture/pr" merge-base HEAD origin/development)" = "$base" ] || fail "merge base with development is wrong"
[ "$(missing "$fixture/pr" "$base")" = 0 ] || fail "files of the merge base are missing"
[ "$(missing "$fixture/pr" "$development_tip")" = 0 ] || fail "files of origin/development are missing"
[ "$(git -C "$fixture/pr" -c remote.origin.promisor=false cat-file blob "$base:policy.json")" = 'base policy' ] ||
  fail "base policy is not readable without a lazy fetch"
[ "$(missing "$fixture/pr" "$base~1")" = 1 ] || fail "fetched blobs of history no test reads"

checkout "$fixture/stacked"
(cd "$fixture/stacked" && "$fetch" stack-base >/dev/null 2>&1)
git -C "$fixture/stacked" rev-parse -q --verify origin/development >/dev/null || fail "stacked run lost origin/development"
[ "$(git -C "$fixture/stacked" merge-base HEAD origin/stack-base)" = "$stack_tip" ] || fail "merge base with the stack base is wrong"
[ "$(missing "$fixture/stacked" "$stack_tip")" = 0 ] || fail "files of the stack base are missing"
[ "$(missing "$fixture/stacked" "$base")" = 0 ] || fail "files of the development merge base are missing in a stacked run"

checkout "$fixture/unreachable"
git -C "$fixture/unreachable" remote set-url origin "file://$fixture/absent"
if (cd "$fixture/unreachable" && "$fetch" >/dev/null 2>&1); then
  fail "a failed fetch must fail the script"
fi
echo "fetch-comparison-history: ok"
