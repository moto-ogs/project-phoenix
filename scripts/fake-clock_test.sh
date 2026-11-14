#!/usr/bin/env bash
# scripts/fake-clock.sh against the real toolchain: a program built under it
# starts at the requested Berlin time, measures real durations, leaves a
# testing/synctest bubble at its own epoch, and moves a fake-clock Postgres
# offset file. A normal build of the same program keeps the real clock.
set -euo pipefail
repo_root=$(git rev-parse --show-toplevel)
fake_clock="$repo_root/scripts/fake-clock.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
export GOCACHE="$fixture/cache" GOFLAGS='' CGO_ENABLED=0 GOTOOLCHAIN=local
version=$(awk '$1 == "go" {print $2; exit}' "$repo_root/backend/go.mod")
printf 'module fakeclockprobe\n\ngo %s\n' "$version" > "$fixture/go.mod"
cat > "$fixture/main.go" <<'GO'
package main

import (
	"fmt"
	"testing"
	"testing/synctest"
	"time"
)

func main() {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		panic(err)
	}
	start := time.Now()
	time.Sleep(20 * time.Millisecond)
	elapsed := time.Since(start)
	fmt.Println(start.In(berlin).Format("2006-01-02T15:04"))
	fmt.Println(elapsed >= 20*time.Millisecond && elapsed < 5*time.Second)
	testing.Main(func(string, string) (bool, error) { return true, nil }, []testing.InternalTest{{
		Name: "TestBubble",
		F: func(t *testing.T) {
			synctest.Test(t, func(*testing.T) { fmt.Println(time.Now().UTC().Year()) })
		},
	}}, nil, nil)
}
GO
fail() { echo "FAIL: $*" >&2; exit 1; }
# A stand-in for the container of scripts/fake-clock-postgres.sh: docker exec
# reads the mounted offset file.
mkdir -p "$fixture/postgres" "$fixture/bin"
echo probe-postgres > "$fixture/postgres/container"
printf '#!/usr/bin/env bash\n[ "$1 $2 $3 $4" = "exec probe-postgres cat /fake-clock/offset" ] && exec cat "%s/postgres/offset"\nexit 1\n' "$fixture" > "$fixture/bin/docker"
chmod +x "$fixture/bin/docker"

out=$(cd "$fixture" && PATH="$fixture/bin:$PATH" PHX_FAKE_CLOCK_POSTGRES_DIR="$fixture/postgres" "$fake_clock" 2027-04-20T00:30 go run . 2> "$fixture/stderr")
mapfile -t lines <<< "$out"
[ "${lines[0]}" = 2027-04-20T00:30 ] || fail "moved clock printed ${lines[0]}, want 2027-04-20T00:30"
[ "${lines[1]}" = true ] || fail "time.Since did not measure the real 20 ms sleep"
[ "${lines[2]}" = 2000 ] || fail "synctest bubble started in ${lines[2]}, want 2000"
grep -q 'Go clock at 2027-04-20T00:30' "$fixture/stderr" || fail "no notice on stderr"
offset=$(cat "$fixture/postgres/offset")
[[ "$offset" =~ ^\+[0-9]{19}$ ]] || fail "Postgres offset file holds '$offset', want a fixed-width offset"

past=$(cd "$fixture" && "$fake_clock" 2026-01-02T08:00 go run . 2> /dev/null | head -n 1)
[ "$past" = 2026-01-02T08:00 ] || fail "a time in the past printed $past"

# The minute may turn while the program compiles.
before=$(TZ=Europe/Berlin date +%Y-%m-%dT%H:%M)
real=$(cd "$fixture" && go run . | head -n 1)
after=$(TZ=Europe/Berlin date +%Y-%m-%dT%H:%M)
[[ "$real" = "$before" || "$real" = "$after" ]] || fail "a normal build printed $real, not the real time"

if "$fake_clock" 20.04.2027 true 2> /dev/null; then fail "an unreadable time was accepted"; fi
echo "fake-clock: ok"
