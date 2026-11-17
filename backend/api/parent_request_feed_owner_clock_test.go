package api

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	feedCompose "github.com/moto-ogs/project-phoenix/modules/parentrequestfeedprojection/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// feedOwnerStart lies years after the database clock: a request stamped by a
// column default would fall before the feed's window and out of its order.
var feedOwnerStart = time.Date(2040, time.June, 15, 9, 0, 0, 0, time.UTC)

// TestParentRequestFeedFiltersAndOrdersOnTheOwnerClock submits one request of
// each kind at the owner's instant, a minute apart, with the database on
// another day (ADR 0281). The feed filters them by the window the owner's
// clock opens and lists them newest first.
func TestParentRequestFeedFiltersAndOrdersOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	phase := testpkg.CreateTestEnrollmentPhase(t, db)
	request := testpkg.CreateTestEnrollmentRequestAwaitingGuardian(t, db, phase.ID, chain.Email, "feed-clock-"+chain.Email)
	var childID int64
	require.NoError(t, db.NewRaw(`INSERT INTO enrollment.request_children
 (tenant_id, request_id, first_name, last_name, date_of_birth, status, created_student_id)
 VALUES (?, ?, 'Feed', 'Clock', '2018-04-15', 'approved', ?) RETURNING id`, chain.TenantID, request.ID, chain.StudentID).Scan(testpkg.Ctx(t), &childID))

	now := feedOwnerStart
	clock := func() time.Time { return now }
	carePlan, err := NewClockedCarePlanForTests(testpkg.NewDatabase(t, db), clock)
	require.NoError(t, err)
	tick := func() { now = now.Add(time.Minute) }
	day := calendar.Date("2040-06-18")

	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, chain.TenantID, func(ctx context.Context, tx bun.Tx) error {
		_, err := carePlan.CreateStudentDataRequest(ctx, careplan.StudentDataChangeRequest{StudentID: chain.StudentID, SubmittedBy: chain.AccountID,
			Target: "student", FieldKey: "school_class", NewValue: json.RawMessage(`"2a"`), Status: "pending"})
		require.NoError(t, err)
		tick()
		_, err = carePlan.CreateCareScheduleRequest(ctx, careplan.CareScheduleChangeRequest{StudentID: chain.StudentID, SubmittedBy: chain.AccountID,
			RequestKind: "weekly_schedule", Payload: json.RawMessage(`{}`), Status: "pending"})
		require.NoError(t, err)
		tick()
		_, err = carePlan.CreateOfferingChange(ctx, careplan.OfferingChangeRequest{StudentID: chain.StudentID, RequestChildID: childID,
			SubmittedBy: chain.AccountID, Payload: json.RawMessage(`{"offerings":[]}`), EffectiveFrom: day.String(), Status: "pending"})
		require.NoError(t, err)
		tick()
		_, err = carePlan.CreateExcusedAbsenceRequest(ctx, careplan.ExcusedAbsenceRequest{StudentID: chain.StudentID, SubmittedBy: chain.AccountID,
			Dates: []careplan.Date{careplan.Date(day)}, Note: "Feed clock", AbsenceStatus: "excused", Status: "pending"})
		require.NoError(t, err)
		tick()
		// Enrollment stamps its change requests on the owner's clock (#7320);
		// the fixture follows it.
		_, err = tx.NewRaw(`INSERT INTO enrollment.change_requests
 (tenant_id, request_id, request_child_id, origin, status, base_snapshot, proposed_snapshot, diff_json, created_at)
 VALUES (?, ?, ?, 'parent', 'pending_review', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, ?)`, chain.TenantID, request.ID, childID, now).Exec(ctx)
		return err
	}))

	since := now.Add(-30 * 24 * time.Hour)
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, chain.TenantID, func(ctx context.Context, tx bun.Tx) error {
		entries, err := feedCompose.NewReader(func(context.Context) (bun.IDB, error) { return tx, nil }).
			ListNewParentRequests(ctx, chain.TenantID, since, true, true)
		require.NoError(t, err)
		kinds := make([]string, 0, len(entries))
		for _, entry := range entries {
			kinds = append(kinds, entry.Kind)
		}
		require.Equal(t, []string{"enrollment", "excused_absence", "offering", "care_schedule", "master_data"}, kinds)
		require.True(t, entries[0].CreatedAt.Equal(now), "the newest entry carries the owner's instant, got %s", entries[0].CreatedAt)
		return nil
	}))
}
