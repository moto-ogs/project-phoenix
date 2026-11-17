package owners

import (
	"context"
	"strings"
	"testing"
	"time"

	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestNightlyRetentionCleanupCutoffsAcrossDST(t *testing.T) {
	t.Parallel()
	suite := newRetentionSuite(t)
	counter := testpkg.CaptureQueriesForContext(t, suite.admin)
	ctx := counter.Context(context.Background())
	// Capture the real owner queries as superuser, so today's database clock
	// cannot reject a cutoff before we replay it at the pinned instants below.
	for _, step := range suite.retention.steps {
		switch step.Kind {
		case "file_cleanup_retention", "staff_cleanup_retention", "student_document_cleanup_retention", "removed_file_retention":
			require.NoError(t, testpkg.WithinTenantContext(t, ctx, suite.admin, testpkg.Tenant(t), func(ctx context.Context) error {
				_, err := step.Run(ctx)
				return err
			}))
		}
	}
	counter.Stop()
	for _, function := range []string{
		"documents.delete_finished_file_cleanups",
		"documents.delete_finished_announcement_attachment_cleanups",
		"users.delete_finished_staff_document_file_cleanups",
		"users.delete_finished_student_document_file_cleanups",
		"documents.delete_removed_files",
	} {
		queries := counter.Selects(function)
		require.Len(t, queries, 1, function)
		_, cutoff, found := strings.Cut(queries[0], ", ")
		require.True(t, found, queries[0])
		cutoff = strings.TrimSuffix(cutoff, ")")
		require.Contains(t, cutoff, "statement_timestamp()")
		cutoff = strings.ReplaceAll(cutoff, "statement_timestamp()", "?::timestamptz")
		for _, month := range []time.Month{time.March, time.October} {
			day := 29
			if month == time.October {
				day = 25
			}
			now := time.Date(2026, month, day, 12, 0, 0, 0, calendar.Berlin)
			var actual time.Time
			require.NoError(t, suite.admin.NewRaw("SELECT "+cutoff, now).Scan(context.Background(), &actual))
			// The SECURITY DEFINER guards evaluate clock_timestamp() - INTERVAL
			// '30 days' in UTC (1.15.606), 30 times 24 hours also across a
			// 23/25-hour Berlin day: a Berlin calendar-day cutoff one hour
			// younger is refused after the spring clock change.
			require.True(t, now.Add(-30*24*time.Hour).Equal(actual), "%s at %s: got %s", function, now, actual)
		}
	}
}

// The two plain deletions date their window on the owner's clock, which
// stamped the rows, and count it in Berlin calendar days (#7295). At noon on
// the day of a clock change the cutoff is noon 365 or 30 calendar days back,
// an hour off the same number of elapsed 24-hour days: a row a minute older
// goes, a row a minute younger stays.
func TestCleanupRetentionCountsBerlinCalendarDaysOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	suite := newRetentionSuite(t)
	school := testpkg.Tenant(t)
	ctx := context.Background()
	for _, now := range []time.Time{
		time.Date(2099, time.March, 29, 12, 0, 0, 0, calendar.Berlin),
		time.Date(2099, time.October, 25, 12, 0, 0, 0, calendar.Berlin),
	} {
		clock := func() time.Time { return now }
		completion := func(resolvedAt time.Time) int64 {
			return suite.insertID(t, `INSERT INTO users.care_withdrawal_completions
				(tenant_id, first_bookingless_day, trigger, withdrawal_confirmed_role, withdrawal_confirmed_at, state, outcome, resolved_at)
				VALUES (?, ?, 'direct_school', 'staff', ?, 'resolved', 'deleted', ?) RETURNING id`,
				school, calendar.DateFromTime(resolvedAt), resolvedAt, resolvedAt)
		}
		offboarding := func(completedAt time.Time) int64 {
			return suite.insertID(t, `INSERT INTO users.staff_offboarding_cleanup (tenant_id, staff_id, completed_at, created_at)
				VALUES (?, (SELECT COALESCE(MAX(staff_id), 0) + 1 FROM users.staff_offboarding_cleanup WHERE tenant_id = ?), ?, ?) RETURNING staff_id`,
				school, school, completedAt, completedAt)
		}
		yearBack, monthBack := now.AddDate(0, 0, -365), now.AddDate(0, 0, -30)
		require.NotEqual(t, 365*24*time.Hour, now.Sub(yearBack), "the window spans a clock change")
		oldCompletion, youngCompletion := completion(yearBack.Add(-time.Minute)), completion(yearBack.Add(time.Minute))
		oldJob, youngJob := offboarding(monthBack.Add(-time.Minute)), offboarding(monthBack.Add(time.Minute))

		require.NoError(t, testpkg.WithinTenantContext(t, ctx, suite.admin, school, func(ctx context.Context) error {
			if _, _, err := carePlanCompose.NewCleanupRetention(clock).DeleteFinishedWithdrawalCompletions(ctx); err != nil {
				return err
			}
			_, _, err := workforceCompose.NewCleanupRetention(clock).DeleteFinishedStaffCleanups(ctx)
			return err
		}))

		require.False(t, suite.exists(t, "users.care_withdrawal_completions", oldCompletion), "resolved a minute before the cutoff at %s", now)
		require.True(t, suite.exists(t, "users.care_withdrawal_completions", youngCompletion), "resolved a minute after the cutoff at %s", now)
		var jobs []int64
		require.NoError(t, suite.admin.NewRaw(`SELECT staff_id FROM users.staff_offboarding_cleanup WHERE tenant_id = ?`, school).Scan(ctx, &jobs))
		require.NotContains(t, jobs, oldJob, "completed a minute before the cutoff at %s", now)
		require.Contains(t, jobs, youngJob, "completed a minute after the cutoff at %s", now)
		_, err := suite.admin.NewRaw(`DELETE FROM users.care_withdrawal_completions WHERE id = ?`, youngCompletion).Exec(ctx)
		require.NoError(t, err)
		_, err = suite.admin.NewRaw(`DELETE FROM users.staff_offboarding_cleanup WHERE tenant_id = ? AND staff_id = ?`, school, youngJob).Exec(ctx)
		require.NoError(t, err)
	}
}
