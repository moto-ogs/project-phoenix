package contracttest_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The parent's "recently decided" windows cut off on the owner's clock, so a
// decided request is in or out by the owner-stamped reviewed_at, never by the
// database stamp of its updated_at (#7295). The owner clock runs 90 days
// apart from PostgreSQL's in both directions.
func TestRecentlyDecidedWindowUsesOwnerClock(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name    string
		offset  time.Duration
		listing func(decidedAt time.Time) time.Time
		visible bool
	}{
		// Decided just now on a clock ahead: inside the two-month window.
		{name: "owner ahead", offset: 90 * 24 * time.Hour, listing: func(at time.Time) time.Time { return at }, visible: true},
		// Decided three months ago on a clock behind: outside the window,
		// although the database stamped the row today.
		{name: "owner behind", offset: -90 * 24 * time.Hour, listing: func(at time.Time) time.Time { return at.AddDate(0, 3, 0) }, visible: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			testpkg.OwnTenant(t)
			db := testpkg.SetupTestDB(t)
			ctx := testpkg.Ctx(t)
			var databaseNow time.Time
			require.NoError(t, db.NewRaw("SELECT now()").Scan(ctx, &databaseNow))
			ownerNow := databaseNow.Add(tc.offset)
			database := testpkg.NewDatabase(t, db)
			care, err := owners.NewUnobservedCarePlan(database, owners.MustNewUnobservedTimetable(database), owners.MustNewPeopleDirectory(database),
				func() time.Time { return ownerNow })
			require.NoError(t, err)
			chain := testpkg.CreateTestParentGuardianChain(t, db)
			_, staffAccount := testpkg.CreateTestStaffWithAccount(t, db, "Rita", "Recent")
			reason := "Passt nicht"

			decideCare := func(reviewedBy *int64) int64 {
				t.Helper()
				row, err := care.CreateCareScheduleRequest(ctx, carerequests.Request{
					StudentID: chain.StudentID, SubmittedBy: chain.AccountID, RequestKind: "weekly_schedule", Status: "pending",
					Payload: json.RawMessage(`{"weekdays":[{"weekday":1,"pickup":"14:00"}]}`),
				})
				require.NoError(t, err)
				require.NoError(t, care.DecideCareScheduleRequest(ctx, careplan.CareScheduleRequestDecision{ID: row.ID, Status: "rejected", Reason: &reason, ReviewedBy: reviewedBy}))
				return row.ID
			}
			reviewed := decideCare(&staffAccount.ID)
			system := decideCare(nil) // a decision without a reviewer

			excused, err := care.CreateExcusedAbsenceRequest(ctx, careplan.ExcusedAbsenceRequest{
				StudentID: chain.StudentID, SubmittedBy: chain.AccountID, Dates: []careplan.Date{"2026-09-14"},
				AbsenceStatus: "excused", Status: "pending",
			})
			require.NoError(t, err)
			require.NoError(t, care.DecideExcusedAbsenceRequest(ctx, careplan.ExcusedAbsenceDecision{ID: excused.ID, Status: "rejected", Reason: &reason, ReviewedBy: &staffAccount.ID}))

			ownerNow = tc.listing(ownerNow)
			since := ownerNow.AddDate(0, -2, 0)
			careRows, err := care.ListCareScheduleRequests(ctx, careplan.CareScheduleRequestFilter{StudentID: chain.StudentID, RecentSince: since})
			require.NoError(t, err)
			excusedRows, err := care.ListExcusedAbsenceRequests(ctx, careplan.ExcusedAbsenceRequestFilter{StudentID: chain.StudentID, RecentSince: since})
			require.NoError(t, err)
			var listed []int64
			for _, row := range careRows {
				listed = append(listed, row.ID)
			}
			var listedExcused []int64
			for _, row := range excusedRows {
				listedExcused = append(listedExcused, row.ID)
			}
			if tc.visible {
				assert.ElementsMatch(t, []int64{reviewed, system}, listed)
				assert.Equal(t, []int64{excused.ID}, listedExcused)
			} else {
				assert.Empty(t, listed)
				assert.Empty(t, listedExcused)
			}
		})
	}
}
