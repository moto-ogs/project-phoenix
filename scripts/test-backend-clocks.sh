#!/usr/bin/env bash
# Runs backend tests once per Berlin time with the Go clock moved there (#4027).
#
#   FAKE_CLOCK_TIMES=$'2027-04-20T00:30\tnach dem Stichtag' \
#     scripts/run-go-toolchain.sh scripts/test-backend-clocks.sh OUT_DIR [go test args...]
#
# Run from backend/. FAKE_CLOCK_TIMES holds one "YYYY-MM-DDTHH:MM reason" per
# line (tab or space before the reason); without it the times come from
# scripts/clock-boundaries.mjs. For every time OUT_DIR gets the gotestsum JSON
# and JUnit files, and summary.md lists the failed tests per time
# (scripts/clock-early-warning.mjs). Every time runs even after a failure; the
# exit status is 1 when any of them failed.
set -euo pipefail

if (($# < 1)); then
  echo "Usage: scripts/test-backend-clocks.sh OUT_DIR [go test args...]" >&2
  exit 2
fi
out=$1
shift
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
times=${FAKE_CLOCK_TIMES:-$(node "$script_dir/clock-boundaries.mjs")}
mkdir -p "$out"
: > "$out/times.tsv"

status=0
while IFS= read -r line; do
  [[ -z "${line//[[:space:]]/}" ]] && continue
  at=${line%%[[:space:]]*}
  reason=${line#"$at"}
  reason=${reason#"${reason%%[![:space:]]*}"}
  name=${at//:/}
  printf '%s\t%s\n' "$at" "$reason" >> "$out/times.tsv"
  echo "::group::Backend tests at $at ($reason)"
  if ! "$script_dir/fake-clock.sh" "$at" go tool gotestsum --format pkgname-and-test-fails \
    --junitfile "$out/junit-$name.xml" --jsonfile "$out/go-test-$name.json" -- "$@"; then
    status=1
  fi
  echo "::endgroup::"
done <<< "$times"

node "$script_dir/clock-early-warning.mjs" summarize "$out" > "$out/summary.md"
cat "$out/summary.md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$out/summary.md" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"
