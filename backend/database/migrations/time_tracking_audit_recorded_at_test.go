package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestTimeTrackingAuditRecordedAtRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	view := func() string {
		t.Helper()
		var sql string
		require.NoError(t, db.NewRaw(`SELECT pg_get_viewdef('audit.time_tracking_audit_log'::regclass, true)`).Scan(ctx, &sql))
		return sql
	}
	afterUp := view()
	require.Contains(t, afterUp, "audit_recorded_at")
	require.Contains(t, afterUp, "audit_reopen_recorded_at")
	require.NoError(t, timeTrackingAuditRecordedAtDown(ctx, db))
	require.NotContains(t, view(), "audit_recorded_at")
	require.NoError(t, timeTrackingAuditRecordedAtUp(ctx, db))
	require.Equal(t, afterUp, view())
}
