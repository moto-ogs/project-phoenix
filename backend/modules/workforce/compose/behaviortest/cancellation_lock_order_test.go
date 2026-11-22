package compose_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A cancellation with covers writes the origin and every cover in one tenant
// transaction, and each write of an upcoming shift locks its person's staff
// row. Staff rows are taken ascending across the whole transaction (#6702),
// so the cancellation must take every person it writes in one sorted batch
// before its first write; otherwise a cover with a smaller staff ID than the
// origin's, or covers listed in descending order, are refused with
// tenant.ErrLockOrder (#7683).
func TestCancellationLocksTheStaffRowsOfOriginAndCoversInOrder(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	// Created in this order, so the IDs ascend: lower < origin < higher < highest.
	lower := testpkg.CreateTestStaff(t, db, "Lina", "Vertretung")
	origin := testpkg.CreateTestStaff(t, db, "Olaf", "Ursprung")
	higher := testpkg.CreateTestStaff(t, db, "Hana", "Vertretung")
	highest := testpkg.CreateTestStaff(t, db, "Hugo", "Vertretung")

	deps := planningDependencies(t, testpkg.Ctx(t), db, buildPlanningWorkforce(t, db), origin.ID)
	// The real School Membership lock admits each staff row through the lock order.
	deps.Workforce = api.NewAbsenceTypeTestCapability(database)
	deps.Staff = owners.NewPlanStaffDirectory(api.NewPeopleRepositorySuiteFactory(database).Staff)
	composition, err := compose.NewShiftPlanning(deps)
	require.NoError(t, err)
	facade := composition.Planning(nil)

	cover := func(staffID int64, start, end string) workforce.ShiftReplacement {
		return workforce.ShiftReplacement{StaffID: staffID, StartTime: start, EndTime: end}
	}
	// Upcoming school days: only shifts from today on lock the staff row.
	for name, tc := range map[string]struct {
		day    calendar.Date
		covers []workforce.ShiftReplacement
	}{
		"a cover with a smaller staff ID than the origin's": {
			day: calendar.NewDate(2036, 3, 3), covers: []workforce.ShiftReplacement{cover(lower.ID, "16:00:00", "16:30:00")},
		},
		"a cover with a larger staff ID than the origin's": {
			day: calendar.NewDate(2036, 3, 4), covers: []workforce.ShiftReplacement{cover(higher.ID, "16:00:00", "16:30:00")},
		},
		"covers with larger staff IDs in descending order": {
			day: calendar.NewDate(2036, 3, 5), covers: []workforce.ShiftReplacement{
				cover(highest.ID, "08:00:00", "12:00:00"), cover(higher.ID, "12:00:00", "16:30:00"),
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			var shift workforce.PlannedShift
			require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
				shift, err = facade.CreateShift(ctx, workforce.CreateStaffShift{StaffShiftInput: workforce.StaffShiftInput{
					StaffID: origin.ID, ActorStaffID: origin.ID, Date: tc.day.String(), StartTime: "08:00:00", EndTime: "16:30:00", BreakMinutes: 30,
				}})
				return err
			}))

			var result workforce.StaffShiftCancellation
			reason := "Krank"
			require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
				result, err = facade.ApplyCancellation(ctx, workforce.CancelStaffShift{
					ShiftID: shift.ID, Cancelled: true, ChangeReason: &reason, ActorStaffID: origin.ID, Replacements: tc.covers,
				})
				return err
			}))
			require.True(t, result.Shift.Cancelled)
			require.Len(t, result.Replacements, len(tc.covers))
			for i, created := range result.Replacements {
				require.Equal(t, tc.covers[i].StaffID, created.StaffID)
			}
		})
	}
}
