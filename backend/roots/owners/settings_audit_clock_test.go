package owners

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"
	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type noRestrictedPhases struct{}

func (noRestrictedPhases) HasActiveClassRestrictedPhase(context.Context) (bool, error) {
	return false, nil
}
func (noRestrictedPhases) HasActiveGradeRestrictedPhase(context.Context) (bool, error) {
	return false, nil
}
func (noRestrictedPhases) MaxActivePhaseGrade(context.Context) (int, error) { return 0, nil }

// A setting change is dated on the database clock, the clock its retention
// function config.delete_expired_setting_audit compares with (ADR 0281). The
// root clock of the settings owner stands years before the database clock:
// the change still carries the database's time, and the retention keeps it
// and deletes only a change aged past three years. Before, the root clock
// dated the change and the retention deleted it at once.
func TestSettingChangeThroughTheRootIsDatedOnTheClockOfItsRetention(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	organizations, err := NewOrganizationTenancy(database)
	require.NoError(t, err)
	rootClock := time.Date(2022, time.March, 27, 2, 30, 0, 0, calendar.Berlin)
	env := RootEnvironment{Logger: slog.Default(), Now: func() time.Time { return rootClock },
		Observe: RootObservers{SettingsLookup: func(string, string, string, time.Duration) {}}}
	owner, err := BuildSettingsOwner(database, testpkg.TenantRuntime(t, db), env, organizations, nil, noRestrictedPhases{})
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	changeIDs := func() []int64 {
		var ids []int64
		require.NoError(t, db.NewRaw(`SELECT id FROM config.setting_audit WHERE tenant_id = ? AND setting_key = ? ORDER BY id`,
			tenantID, settingsModule.KeyFeedbackEnabled).Scan(context.Background(), &ids))
		return ids
	}

	require.NoError(t, owner.Service.SetValue(ctx, settingsModule.KeyFeedbackEnabled, true, nil, nil))
	require.NoError(t, owner.Service.SetValue(ctx, settingsModule.KeyFeedbackEnabled, false, nil, nil))
	ids := changeIDs()
	require.Len(t, ids, 2)
	aged, fresh := ids[0], ids[1]
	var databaseTime bool
	require.NoError(t, db.NewRaw(`SELECT changed_at > now() - INTERVAL '1 hour' FROM config.setting_audit WHERE id = ?`, fresh).
		Scan(context.Background(), &databaseTime))
	assert.True(t, databaseTime, "the change carries the database's time, not the root clock's")
	_, err = db.ExecContext(context.Background(), `UPDATE config.setting_audit SET changed_at = now() - INTERVAL '3 years 1 day' WHERE id = ?`, aged)
	require.NoError(t, err)

	require.NoError(t, testpkg.WithinTenantContext(t, context.Background(), db, tenantID, func(txCtx context.Context) error {
		_, _, err := settingsCompose.NewAuditRetention().DeleteExpiredSettingChanges(txCtx)
		return err
	}))
	assert.Equal(t, []int64{fresh}, changeIDs(), "the retention keeps the fresh change and deletes the aged one")
}
