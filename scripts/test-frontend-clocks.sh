#!/usr/bin/env bash
# Runs the frontend Vitest suite once per Berlin time with the frozen test
# clock moved there (#7296).
#
#   FAKE_CLOCK_TIMES=$'2027-03-28T00:30\tTag der Zeitumstellung' \
#     ../scripts/test-frontend-clocks.sh OUT_DIR [vitest args...]
#
# Run from frontend/. FAKE_CLOCK_TIMES holds one "YYYY-MM-DDTHH:MM reason" per
# line (tab or space before the reason); without it the times come from
# scripts/clock-boundaries.mjs. Every test starts on the given time instead of
# TEST_CLOCK_INSTANT's default (frontend/src/test/clock-instant.ts); a test
# that sets its own time keeps it. For every time OUT_DIR gets the Vitest JSON
# report, and summary.md lists the failed tests per time
# (scripts/clock-early-warning.mjs). Every time runs even after a failure; the
# exit status is 1 when any of them failed.
set -euo pipefail

if (($# < 1)); then
  echo "Usage: scripts/test-frontend-clocks.sh OUT_DIR [vitest args...]" >&2
  exit 2
fi
out=$1
shift
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
times=${FAKE_CLOCK_TIMES:-$(node "$script_dir/clock-boundaries.mjs")}
mkdir -p "$out"
out=$(cd -- "$out" && pwd)
: > "$out/times.tsv"

status=0
while IFS= read -r line; do
  [[ -z "${line//[[:space:]]/}" ]] && continue
  at=${line%%[[:space:]]*}
  reason=${line#"$at"}
  reason=${reason#"${reason%%[![:space:]]*}"}
  name=${at//:/}
  seconds=$(node "$script_dir/clock-boundaries.mjs" --at "$at")
  instant=$(node -e 'console.log(new Date(Number(process.argv[1]) * 1000).toISOString())' "$seconds")
  printf '%s\t%s\n' "$at" "$reason" >> "$out/times.tsv"
  echo "::group::Frontend tests at $at ($reason)"
  if ! TEST_CLOCK_INSTANT=$instant pnpm exec vitest run --reporter=dot --reporter=json \
    --outputFile.json="$out/vitest-$name.json" "$@"; then
    status=1
  fi
  echo "::endgroup::"
done <<< "$times"

node "$script_dir/clock-early-warning.mjs" summarize "$out" --suite frontend > "$out/summary.md"
cat "$out/summary.md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$out/summary.md" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"
