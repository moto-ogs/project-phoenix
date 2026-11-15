package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSettingAuditRetentionRunsInUTC pins the three-year windows of the
// #6844 audit prunes to UTC, as 1.15.606 does for the other fixed windows:
// INTERVAL '3 years' then lands on the same UTC clock time whatever the
// calling session's timezone (#7104).
func TestSettingAuditRetentionRunsInUTC(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	for _, procedure := range []string{
		"config.delete_expired_setting_audit(bigint)",
		"config.delete_expired_traeger_setting_audit(bigint)",
		"platform.delete_expired_traeger_master_data_audit(bigint)",
	} {
		var utc bool
		require.NoError(t, db.NewRaw(`SELECT 'TimeZone=UTC' = ANY(COALESCE(proconfig, '{}')) FROM pg_proc WHERE oid = ?::regprocedure`, procedure).
			Scan(t.Context(), &utc), procedure)
		assert.True(t, utc, "%s runs in the session timezone", procedure)
	}
}
