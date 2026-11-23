package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ParentRequestVersion is the version a reader of one parent-request row
// sends back as expected_version (ADR 0311): the token of its stored
// updated_at, as the lists emit it. The row must exist: a missing row has
// no version, and a test of a missing row sends its own token.
func ParentRequestVersion(t testing.TB, table string, id int64) string {
	t.Helper()
	return ParentRequestVersionIn(t, SetupTestDB(t), table, id)
}

// MissingRequestVersion is the token a test of a missing request sends: no
// row has a version, and any non-empty token reaches the not-found answer.
const MissingRequestVersion = "no-request-has-this-version"

// ParentRequestVersionIn is ParentRequestVersion read from db, for rigs that
// hold their own isolated database.
func ParentRequestVersionIn(t testing.TB, db bun.IDB, table string, id int64) string {
	t.Helper()
	var updatedAt time.Time
	require.NoError(t, db.NewRaw(`SELECT updated_at FROM ? WHERE id = ?`, bun.Ident(table), id).
		Scan(context.Background(), &updatedAt), "read the version of %s %d", table, id)
	return readstate.Of(updatedAt)
}

// CareRequestVersion is ParentRequestVersion of a care-schedule or
// pickup-change request.
func CareRequestVersion(t testing.TB, id int64) string {
	return ParentRequestVersion(t, "schedule.care_schedule_change_requests", id)
}

// ExcusedRequestVersion is ParentRequestVersion of an absence request.
func ExcusedRequestVersion(t testing.TB, id int64) string {
	return ParentRequestVersion(t, "active.excused_absence_requests", id)
}

// MasterDataRequestVersion is ParentRequestVersion of a master-data request.
func MasterDataRequestVersion(t testing.TB, id int64) string {
	return ParentRequestVersion(t, "users.student_data_change_requests", id)
}

// OfferingRequestVersion is ParentRequestVersion of an offering-change
// request.
func OfferingRequestVersion(t testing.TB, id int64) string {
	return ParentRequestVersion(t, "enrollment.offering_change_requests", id)
}
