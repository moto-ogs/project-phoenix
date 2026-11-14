#!/usr/bin/env bash
# Runs a command with the Go clock moved to another day (#4027).
#
#   scripts/run-go-toolchain.sh scripts/fake-clock.sh 2027-04-20T00:30 \
#     scripts/test-backend.sh -count=1 ./modules/timetable/...
#   scripts/run-go-toolchain.sh scripts/fake-clock.sh @1807135200 go test ...
#
# The time is Berlin wall-clock time (YYYY-MM-DD, optionally THH:MM) or Unix
# seconds after "@". Every Go program the command builds gets a copy of the
# standard library's time.Now that adds PHX_CLOCK_OFFSET_SECONDS to the wall
# clock, so tests start at that time and the clock runs on from there.
# Monotonic time stays real: durations, timers and deadlines are unaffected.
#
# With PHX_FAKE_CLOCK_POSTGRES_DIR set to the directory of a server from
# scripts/fake-clock-postgres.sh, PostgreSQL moves too. Otherwise only Go
# moves: now(), CURRENT_DATE and file modification times keep the real time,
# and a test that mixes them fails although the moved day itself would not
# break it. File modification times always stay real.
#
# The overlay changes the build of package time and therefore the build ID of
# every package: the first run compiles the backend once more, later runs
# reuse that build from the Go cache. -count=1 is needed because the result
# cache does not see the offset. The test database lifecycle
# (internal/testdb) subtracts the offset again, so templates and leases that
# other runs share keep the real time.
set -euo pipefail

if (($# < 2)); then
  echo "Usage: scripts/fake-clock.sh <YYYY-MM-DD[THH:MM] Berlin | @unix-seconds> <command> [args...]" >&2
  exit 2
fi
target=$1
shift

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
case "$target" in
  @*) target_seconds=${target#@} ;;
  *) target_seconds=$(node "$script_dir/clock-boundaries.mjs" --at "$target") ;;
esac
if [[ ! "$target_seconds" =~ ^[0-9]+$ ]]; then
  echo "fake-clock: cannot read the time '$target'" >&2
  exit 2
fi

goroot=$(go env GOROOT)
original="$goroot/src/time/time.go"
anchor=$'\tsec, nsec, mono := runtimeNow()'
if [[ $(grep -cxF -- "$anchor" "$original") != 1 ]]; then
  echo "fake-clock: $original no longer has exactly one '${anchor#$'\t'}'." >&2
  echo "Adapt scripts/fake-clock.sh to this Go version." >&2
  exit 1
fi

# One overlay per Go version and offset source, outside the worktree, so all
# runs share one compiled time package. Write and rename: runs in other
# worktrees may build from the same files at the same moment.
offset_source="$script_dir/fake-clock/offset.go"
key=$( { go env GOVERSION; cat "$original" "$offset_source"; } | git hash-object --stdin)
overlay_dir="$(go env GOCACHE)/phoenix-fake-clock/$key"
if [[ ! -s "$overlay_dir/overlay.json" ]]; then
  mkdir -p "$overlay_dir"
  tmp=$(mktemp -d "$overlay_dir/.tmp.XXXXXX")
  awk -v anchor="$anchor" '
    { print }
    $0 == anchor { print "\tif !runtimeIsBubbled() {\n\t\tsec += fakeClockOffset\n\t}" }
  ' "$original" > "$tmp/time.go"
  cp "$offset_source" "$tmp/zz_phoenix_fake_clock.go"
  mv -f "$tmp/time.go" "$overlay_dir/time.go"
  mv -f "$tmp/zz_phoenix_fake_clock.go" "$overlay_dir/zz_phoenix_fake_clock.go"
  printf '{"Replace":{"%s":"%s","%s":"%s"}}\n' \
    "$original" "$overlay_dir/time.go" \
    "$goroot/src/time/zz_phoenix_fake_clock.go" "$overlay_dir/zz_phoenix_fake_clock.go" \
    > "$tmp/overlay.json"
  mv -f "$tmp/overlay.json" "$overlay_dir/overlay.json"
  rmdir "$tmp"
fi

PHX_CLOCK_OFFSET_SECONDS=$((target_seconds - $(date +%s)))
export PHX_CLOCK_OFFSET_SECONDS
# A server from scripts/fake-clock-postgres.sh moves with Go. libfaketime
# rereads the file about once a second.
if [[ -n "${PHX_FAKE_CLOCK_POSTGRES_DIR:-}" ]]; then
  printf '%+d\n' "$PHX_CLOCK_OFFSET_SECONDS" > "$PHX_FAKE_CLOCK_POSTGRES_DIR/offset"
  sleep 2
fi
export GOFLAGS="${GOFLAGS:+$GOFLAGS }-overlay=$overlay_dir/overlay.json"
echo "fake-clock: Go clock at $target (offset ${PHX_CLOCK_OFFSET_SECONDS}s)" >&2
exec "$@"
