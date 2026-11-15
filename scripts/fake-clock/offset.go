// This file is not part of any module. scripts/fake-clock.sh adds it to the
// standard library's package time through go's -overlay flag, together with a
// copy of time.go whose Now adds fakeClockOffset to the wall clock (#4027).
package time

import "syscall"

// fakeClockOffset moves the wall clock of Now by PHX_CLOCK_OFFSET_SECONDS.
// Monotonic readings stay real, so Sub, Since, Until, timers and deadlines
// keep measuring real durations. A testing/synctest bubble keeps its own fake
// clock, which starts at 2000-01-01 whatever the offset.
var fakeClockOffset = parseFakeClockOffset()

func parseFakeClockOffset() int64 {
	value, ok := syscall.Getenv("PHX_CLOCK_OFFSET_SECONDS")
	if !ok || value == "" {
		return 0
	}
	negative := value[0] == '-'
	if negative {
		value = value[1:]
	}
	var offset int64
	for i := 0; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' || i >= 12 {
			panic("time: PHX_CLOCK_OFFSET_SECONDS must be whole seconds, got " + value)
		}
		offset = offset*10 + int64(value[i]-'0')
	}
	if negative {
		return -offset
	}
	return offset
}
