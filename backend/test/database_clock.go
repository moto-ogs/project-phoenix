package test

import (
	"testing"
	"time"

	"github.com/uptrace/bun"
)

// DatabaseClock returns a clock that reads PostgreSQL's clock_timestamp().
// A composition whose decisions run on the database clock (the data return,
// ADR 0274; database-stamped columns, ADR 0281) gets it in tests, so its
// instants stay on that clock when the Go clock is moved to another day.
// A failed read marks the test failed; the clock may run in a server goroutine.
func DatabaseClock(t testing.TB, db bun.IDB) func() time.Time {
	t.Helper()
	return func() time.Time {
		var now time.Time
		if err := db.NewRaw(`SELECT clock_timestamp()`).Scan(t.Context(), &now); err != nil {
			t.Errorf("read the database clock: %v", err)
		}
		return now
	}
}
