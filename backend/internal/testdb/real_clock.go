package testdb

import (
	"os"
	"strconv"
	"time"
)

// fakeClockOffsetEnv is set by scripts/fake-clock.sh, which moves time.Now of
// every Go program it builds by that many seconds (#4027).
const fakeClockOffsetEnv = "PHX_CLOCK_OFFSET_SECONDS"

// realNow is the machine's wall clock, also under scripts/fake-clock.sh. The
// test server, its templates and its lease files are shared with runs of
// other worktrees on the real clock: a template stamped a year ahead would
// outlive its GC, and a sweep a year ahead would drop every other template.
func realNow() time.Time {
	return withoutFakeClockOffset(time.Now(), os.Getenv(fakeClockOffsetEnv))
}

func withoutFakeClockOffset(now time.Time, offset string) time.Time {
	seconds, err := strconv.ParseInt(offset, 10, 64)
	if err != nil {
		return now
	}
	return now.Add(-time.Duration(seconds) * time.Second)
}
