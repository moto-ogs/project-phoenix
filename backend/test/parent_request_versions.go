package test

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ParentRequestVersion is the version a reader of one parent-request row
// sends back as expected_version (ADR 0311): the token of its stored
// updated_at, as the lists emit it. A row that does not exist has no
// version; its token is only non-empty, so the write reaches its not-found
// answer.
func ParentRequestVersion(t testing.TB, table string, id int64) string {
	t.Helper()
	var updatedAt time.Time
	err := SetupTestDB(t).NewRaw(`SELECT updated_at FROM ? WHERE id = ?`, bun.Ident(table), id).
		Scan(context.Background(), &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "missing-row"
	}
	require.NoError(t, err, "read the version of %s %d", table, id)
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
