package migrations

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestTimetableRetentionDatabaseDayRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()

	assertCutoff := func() {
		t.Helper()
		before := calendar.DateFromTime(testpkg.DatabaseNow(t, db)).AddDays(-30)
		var cutoff string
		require.NoError(t, db.NewRaw(`SELECT audit.timetable_retention_cutoff(30)::text`).Scan(ctx, &cutoff))
		after := calendar.DateFromTime(testpkg.DatabaseNow(t, db)).AddDays(-30)
		require.Contains(t, []string{before.String(), after.String()}, cutoff)
	}
	assertCutoff()
	require.NoError(t, timetableRetentionDatabaseDayDown(ctx, db))
	var exists bool
	require.NoError(t, db.NewRaw(`SELECT to_regprocedure('audit.timetable_retention_cutoff(integer)') IS NOT NULL`).Scan(ctx, &exists))
	require.False(t, exists)
	require.NoError(t, timetableRetentionDatabaseDayUp(ctx, db))
	assertCutoff()
}
