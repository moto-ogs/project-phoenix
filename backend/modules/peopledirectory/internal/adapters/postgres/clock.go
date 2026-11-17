package postgres

import "time"

// clock is the composition's clock a store stamps its writes with: deletion
// marks, ledger rows and team notices carry the owner's instant, not the
// database's (ADR 0281). A store built without it serves reads only.
type clock struct{ now func() time.Time }

func newClock(now func() time.Time) clock {
	if now == nil {
		panic("people directory postgres: the composition's clock is required")
	}
	return clock{now: now}
}

// stamp is the instant of a write. Stamping on a store without the clock is a
// wiring error.
func (c clock) stamp() time.Time {
	if c.now == nil {
		panic("people directory postgres: a store without the composition's clock stamps a write")
	}
	return c.now()
}

// WithClock returns the store stamping its writes with now.
func (s *Store) WithClock(now func() time.Time) *Store {
	clocked := *s
	clocked.clock = newClock(now)
	return &clocked
}

// WithClock returns the store stamping its writes with now.
func (s *StudentStore) WithClock(now func() time.Time) *StudentStore {
	clocked := *s
	clocked.clock = newClock(now)
	return &clocked
}

// WithClock returns the store stamping its writes with now.
func (s *StudentNoteStore) WithClock(now func() time.Time) *StudentNoteStore {
	clocked := *s
	clocked.clock = newClock(now)
	return &clocked
}
