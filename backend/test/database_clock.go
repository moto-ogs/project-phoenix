package test

import (
	"testing"
	"time"

	"github.com/uptrace/bun"
)

// DatabaseNow reads PostgreSQL's clock once. A test places or asserts a
// value that the database bounds or stamps with it (the retrieval period of
// the data return, ADR 0274; database-stamped columns, ADR 0281); the code
// under test keeps the clock production gives it.
func DatabaseNow(t testing.TB, db bun.IDB) time.Time {
	t.Helper()
	var now time.Time
	if err := db.NewRaw(`SELECT now()`).Scan(t.Context(), &now); err != nil {
		t.Fatalf("read the database clock: %v", err)
	}
	return now
}
