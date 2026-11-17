package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestAbsenceHistoryOrdersDecisionsOnTheOwnersClock pins the order of the
// decided requests (#7295, ADR 0281): it compares the approval time of one
// request with the last change of another, so both carry the owner's clock.
// The clock runs years ahead of the database's; a cancel stamped by the
// database would sort below the earlier approval.
func TestAbsenceHistoryOrdersDecisionsOnTheOwnersClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	staff := testpkg.CreateTestStaff(t, db, "Lea", "Verlauf")
	at := time.Date(2099, time.March, 2, 9, 0, 0, 0, calendar.Berlin)
	store := New(DatabaseRuntime(db)).WithClock(func() time.Time { return at })
	ctx := testpkg.Ctx(t)

	var approved, canceled domain.StaffAbsence
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
		create := func(day string) domain.StaffAbsence {
			created, _, err := store.CreateStaffAbsence(ctx, domain.StaffAbsence{
				StaffID: staff.ID, AbsenceType: workforce.AbsenceTypeVacation, DateStart: day, DateEnd: day,
				Status: workforce.AbsenceStatusRequested, CreatedBy: staff.ID,
			})
			require.NoError(t, err)
			return created
		}
		approved, canceled = create("2099-04-01"), create("2099-04-02")
		decidedAt := at
		approved.Status, approved.ApprovedBy, approved.ApprovedAt = workforce.AbsenceStatusApproved, &staff.ID, &decidedAt
		_, found, _, err := store.UpdateStaffAbsence(ctx, approved)
		require.NoError(t, err)
		require.True(t, found)
		at = at.Add(time.Hour)
		canceled.Status = workforce.AbsenceStatusCanceled
		_, found, _, err = store.UpdateStaffAbsence(ctx, canceled)
		require.NoError(t, err)
		require.True(t, found)
		return nil
	}))

	var history []domain.StaffAbsence
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
		var err error
		history, _, err = store.ListStaffAbsenceRequests(ctx, domain.StaffAbsenceRequestFilter{
			Statuses: []string{workforce.AbsenceStatusApproved, workforce.AbsenceStatusCanceled}, Decided: true,
			FilterSubjects: true, SubjectStaffIDs: []int64{staff.ID},
		})
		return err
	}))
	require.Len(t, history, 2)
	assert.Equal(t, []int64{canceled.ID, approved.ID}, []int64{history[0].ID, history[1].ID}, "the later cancel comes first")
	assert.True(t, history[0].UpdatedAt.Equal(at), "the cancel is stamped on the owner's clock")
	assert.True(t, history[1].RequestedAt.Equal(at.Add(-time.Hour)), "the request is stamped on the owner's clock too")
}
