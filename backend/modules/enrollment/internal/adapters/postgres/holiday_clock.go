package postgres

import "time"

// holidayClock is the owner clock of the holiday stores (ADR 0239, ADR
// 0281). Only WithClock sets it; a store without it serves reads only.
type holidayClock func() time.Time

// holidayNow reads clock; a write that stamps on a store built without
// WithClock is a wiring error (ADR 0275).
func holidayNow(clock holidayClock) time.Time {
	if clock == nil {
		panic("enrollment holiday store: a write needs the clock of WithClock")
	}
	return clock()
}
