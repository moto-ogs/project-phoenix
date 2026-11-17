package api

import (
	"context"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/realtime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// noExitNoticeRecipients holds users:delete for nobody, so an exit tells
// no one and the notification owners stay untouched.
type noExitNoticeRecipients struct{}

func (noExitNoticeRecipients) ListStaffWithPermission(context.Context, string) ([]*peopleValues.StaffWithRoleInfo, error) {
	return nil, nil
}

// The Worker's planned exits decide on the root's day (#7104): with the
// clock years ahead, an exit whose day the real calendar has not reached
// yet is due and carried out.
func TestPlannedStaffExitsRunOnTheRootsDay(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	unit := testpkg.TenantRuntime(t, db)
	pinned := time.Date(2040, time.March, 14, 12, 0, 0, 0, calendar.Berlin)
	identity, err := lifecycleTestModule(testpkg.NewDatabase(t, db), unit, GuardianInvitationTestConfig{})
	require.NoError(t, err)
	logger := slog.New(slog.DiscardHandler)
	notifications := owners.DeliveryNotifications{
		Notifier: struct{ deliveryCompose.Notifier }{},
		Preferences: struct {
			deliveryCompose.NotificationPreferenceService
		}{},
	}
	run := PlannedStaffExitsJob(testpkg.NewDatabase(t, db), realtime.NewHub(logger), logger, func() time.Time { return pinned })(
		identity, notifications, noExitNoticeRecipients{})

	staff := testpkg.CreateTestStaff(t, db, "Geplant", "Gehend")
	planner := testpkg.CreateTestStaff(t, db, "Planende", "Leitung")
	plannerAccount := testpkg.CreateTestAccount(t, db, fmt.Sprintf("planned-exit-clock-%d@test.local", testpkg.UniqueSuffix()))
	_, err = db.NewRaw(`UPDATE users.staff_school_memberships SET planned_exit_day = ?, planned_exit_by_account_id = ?,
		planned_exit_by_staff_id = ?, planned_exit_by_name = 'Leitung', planned_exit_at = ? WHERE tenant_id = ? AND id = ?`,
		calendar.NewDate(2039, 12, 1), plannerAccount.ID, planner.ID, pinned.AddDate(0, -6, 0), testpkg.Tenant(t), staff.ID).Exec(t.Context())
	require.NoError(t, err)

	ctx := tenant.WithUnitOfWork(testpkg.ContextForTenant(testpkg.WithTenantRuntime(t, t.Context(), db), testpkg.Tenant(t)), unit)
	_, err = testpkg.TenantQuery0(t, ctx, db, func(ctx context.Context) (struct{}, error) { return struct{}{}, run(ctx) })
	require.NoError(t, err)

	var deletedAt *time.Time
	require.NoError(t, db.NewSelect().TableExpr(`users.staff_school_memberships`).ColumnExpr(`deleted_at`).
		Where(`tenant_id = ? AND id = ?`, testpkg.Tenant(t), staff.ID).Scan(t.Context(), &deletedAt))
	require.NotNil(t, deletedAt, "the exit of 2039-12-01 is due on the root's day 2040-03-14")
}
