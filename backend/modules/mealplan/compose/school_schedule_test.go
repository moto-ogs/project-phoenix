package compose

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestSchoolScheduleRequiresCareOnEffectiveDate(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	effective := calendar.NewDate(2026, 9, 10)
	before, after := effective.AddDays(-1), effective.AddDays(1)
	for _, tc := range []struct {
		name        string
		from, until *calendar.Date
		status      string
		allowed     bool
	}{
		{name: "care already ended", until: &before, status: "active"},
		{name: "care not started yet", from: &after, status: "active"},
		{name: "inactive membership", status: "inactive"},
		{name: "first day of care", from: &effective, status: "active", allowed: true},
		{name: "last day of care", until: &effective, status: "active", allowed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctx := testpkg.OwnCtx(t)
			student := testpkg.CreateTestStudent(t, db, "Sina", "Schedule", "1a")
			staff := testpkg.CreateTestAccount(t, db, "meal-schedule-staff")
			_, err := db.NewRaw(`UPDATE users.student_school_memberships SET enrolled_from = ?, enrolled_until = ?, status = ? WHERE tenant_id = ? AND student_profile_id = ?`, tc.from, tc.until, tc.status, student.TenantID, student.ID).Exec(ctx)
			require.NoError(t, err)
			module := buildModuleAt(t, db, true, nil, time.Date(2026, 9, 9, 8, 0, 0, 0, testBerlin))
			from, err := module.ReplaceScheduleBySchool(ctx, SchoolAsRead(t, module, ctx, mealplan.SchoolSchedule{
				StudentID: student.ID, StaffAccountID: staff.ID,
				Weekdays: []mealplan.Weekday{mealplan.Thursday}, EffectiveFrom: mealplan.Date(effective),
			}))
			var wantWrites int64
			if tc.allowed {
				require.NoError(t, err)
				assert.Equal(t, mealplan.Date(effective), from)
				wantWrites = 1
			} else {
				require.ErrorIs(t, err, mealplan.ErrChildNotEnrolled)
			}
			for _, table := range []string{"schedule.meal_participation_schedules", "schedule.meal_registration_changes"} {
				count, countErr := db.NewSelect().TableExpr(table).Where("tenant_id = ? AND student_id = ?", student.TenantID, student.ID).Count(ctx)
				require.NoError(t, countErr)
				assert.Equal(t, wantWrites, count, table)
			}
		})
	}
}

// A change of a child's regular days carries the version its author read
// (ADR 0311): once a colleague or a parent changed them, the older read is
// refused and writes nothing, for the school as for a parent; the version
// read again saves.
func TestScheduleChangesRefuseAnOutdatedRead(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.OwnCtx(t)
	student := testpkg.CreateTestStudent(t, db, "Vera", "Version", "2b")
	staff := testpkg.CreateTestAccount(t, db, "meal-schedule-version")
	module := buildModuleAt(t, db, true, nil, time.Date(2026, 9, 2, 8, 0, 0, 0, testBerlin))
	school := func(weekdays []mealplan.Weekday, version string) error {
		_, err := module.ReplaceScheduleBySchool(ctx, mealplan.SchoolSchedule{
			StudentID: student.ID, StaffAccountID: staff.ID, Weekdays: weekdays, EffectiveFrom: "2026-09-14", ExpectedVersion: version,
		})
		return err
	}
	parent := func(weekdays []mealplan.Weekday, version string) error {
		_, err := module.ReplaceParticipationSchedule(ctx, mealplan.ReplaceParticipationSchedule{
			StudentID: student.ID, GuardianAccountID: staff.ID, Weekdays: weekdays, ExpectedVersion: version,
		})
		return err
	}
	stored := func() int64 {
		count, err := db.NewSelect().TableExpr("schedule.meal_participation_schedules").Where("tenant_id = ? AND student_id = ?", student.TenantID, student.ID).Count(ctx)
		require.NoError(t, err)
		return count
	}

	firstRead := ReadVersion(t, module, ctx, student.ID)
	require.NotEmpty(t, firstRead, "no regular days have a version too")
	require.NoError(t, school([]mealplan.Weekday{mealplan.Monday}, firstRead))
	require.EqualValues(t, 1, stored())

	require.ErrorIs(t, school([]mealplan.Weekday{mealplan.Tuesday}, firstRead), readstate.ErrChanged)
	require.ErrorIs(t, parent([]mealplan.Weekday{mealplan.Tuesday}, firstRead), readstate.ErrChanged)
	require.ErrorIs(t, parent([]mealplan.Weekday{mealplan.Tuesday}, ""), readstate.ErrChanged)
	plan, err := module.ParticipationBySchool(ctx, student.ID, "2026-09-14", "2026-09-14")
	require.NoError(t, err)
	assert.Equal(t, []mealplan.Weekday{mealplan.Monday}, plan.Weekdays, "a refused change writes nothing")
	assert.EqualValues(t, 1, stored())

	require.NoError(t, parent([]mealplan.Weekday{mealplan.Friday}, plan.Version))
}
