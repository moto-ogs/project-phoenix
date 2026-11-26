package compose

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestMealCancellationClosesTheDayUntilItIsRemoved is the effect of a
// cancelled lunch (#7656) on everything that reads the day: a booked child
// no longer eats, the kitchen list is empty and marked as cancelled, a
// change of the day is refused, and the Mensa month does not count the day.
// Removing the cancellation lets the booking apply again. A closing day, a
// past day and another school keep their own state.
func TestMealCancellationClosesTheDayUntilItIsRemoved(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	school := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Mia", "Mittag", "2a")
	account := testpkg.CreateTestAccount(t, db, "meal-cancellation")
	monday, closingDay := calendar.NewDate(2026, 9, 7), "2026-09-11"
	_, err := db.ExecContext(ctx, `INSERT INTO schedule.meal_participation_schedules
  (tenant_id, student_id, effective_from, monday, tuesday, wednesday, thursday, friday, changed_by_account_id)
  VALUES (?, ?, ?, TRUE, TRUE, TRUE, TRUE, TRUE, ?)`, school, student.ID, monday, account.ID)
	require.NoError(t, err)
	services, err := New(Dependencies{
		DB: db, Settings: enabledTestSettings(nil), Observe: func(Observation) {},
		Now:          func() time.Time { return time.Date(2026, 9, 7, 8, 0, 0, 0, testBerlin) },
		Participants: testParticipantFinder, ParticipantDays: testParticipantDaysFinder,
		StudentNames: testStudentNames, LockStudent: testStudentLock,
		Calendar: fixedCalendar([]string{closingDay}, nil), CancelledDays: NewCancelledDays(),
	})
	require.NoError(t, err)
	plan, cancellations := services.Capability, services.Cancellations
	wednesday := mealplan.Date(monday.AddDays(2).String())
	months, err := NewBillingMonths(plan, fixedCalendar([]string{closingDay}, nil),
		func(context.Context, calendar.Date, calendar.Date) (map[calendar.Date]map[int64]bool, error) {
			present := map[calendar.Date]map[int64]bool{}
			for day := calendar.NewDate(2026, 9, 1); day.Before(calendar.NewDate(2026, 10, 1)); day = day.AddDays(1) {
				present[day] = map[int64]bool{student.ID: true}
			}
			return present, nil
		},
		func(context.Context) (calendar.Date, error) { return calendar.NewDate(2026, 1, 1), nil })
	require.NoError(t, err)
	// mealDays is the child's counted meals of September 2026.
	mealDays := func() int {
		var month mealplan.BillingMonth
		require.NoError(t, tenant.NewTransactionRunner().RunInTx(ctx, func(txCtx context.Context) error {
			var readErr error
			month, readErr = months.BillingMonth(txCtx, "2026-09-01")
			return readErr
		}))
		for _, child := range month.Children {
			if child.StudentID.Int64() == student.ID {
				return child.MealDays
			}
		}
		return 0
	}
	// Monday 7 to Wednesday 30 September, without the closing day Friday 11.
	const bookedDays = 17
	require.Equal(t, bookedDays, mealDays(), "every booked school day counts before the cancellation")

	require.NoError(t, cancellations.CancelMeal(ctx, mealplan.MealCancellation{Date: wednesday, Reason: "  Der Caterer liefert nicht  "}))

	t.Run("the day reads as cancelled", func(t *testing.T) {
		list, err := plan.DailyList(ctx, wednesday)
		require.NoError(t, err)
		assert.True(t, list.Closed)
		assert.True(t, list.MealCancelled)
		assert.Empty(t, list.Participants, "the kitchen list is empty")
		tuesday, err := plan.DailyList(ctx, mealplan.Date(monday.AddDays(1).String()))
		require.NoError(t, err)
		assert.False(t, tuesday.MealCancelled)
		assert.Equal(t, []int64{student.ID}, dailyParticipantIDs(tuesday), "the day before keeps its booking")
		week, err := plan.ParticipationBySchool(ctx, student.ID, mealplan.Date(monday.String()), mealplan.Date(monday.AddDays(4).String()))
		require.NoError(t, err)
		assert.False(t, week.Days[2].Participating, "the booking of the day lapses")
		assert.Equal(t, mealplan.ParticipationClosed, week.Days[2].Source)
		orders, err := plan.Orders(ctx, wednesday, wednesday)
		require.NoError(t, err)
		require.Len(t, orders.Days, 1)
		assert.True(t, orders.Days[0].MealCancelled)
		assert.Zero(t, orders.Days[0].Total)
		listed, err := cancellations.MealCancellations(ctx, mealplan.Date(monday.String()), mealplan.Date(monday.AddDays(4).String()))
		require.NoError(t, err)
		assert.Equal(t, []mealplan.MealCancellation{{Date: wednesday, Reason: "Der Caterer liefert nicht"}}, listed)
	})

	t.Run("a change of the day is refused and the month does not count it", func(t *testing.T) {
		err := plan.SetParticipationBySchool(ctx, mealplan.SchoolChange{StudentID: student.ID, StaffAccountID: account.ID, Date: wednesday, Participating: true})
		assert.ErrorIs(t, err, mealplan.ErrDayClosed)
		assert.Equal(t, bookedDays-1, mealDays(), "a booked day without lunch is not billed")
	})

	t.Run("a closing day, a past day and an empty reason are refused", func(t *testing.T) {
		assert.ErrorIs(t, cancellations.CancelMeal(ctx, mealplan.MealCancellation{Date: mealplan.Date(closingDay), Reason: "Ausfall"}), mealplan.ErrDayClosed)
		assert.ErrorIs(t, cancellations.CancelMeal(ctx, mealplan.MealCancellation{Date: "2026-09-04", Reason: "Ausfall"}), mealplan.ErrPastDay)
		assert.ErrorIs(t, cancellations.CancelMeal(ctx, mealplan.MealCancellation{Date: wednesday, Reason: " "}), mealplan.ErrInvalidMealCancellation)
		assert.ErrorIs(t, cancellations.CancelMeal(ctx, mealplan.MealCancellation{Date: "2026-09-12", Reason: "Ausfall"}), mealplan.ErrInvalidMealDate)
	})

	t.Run("another school keeps its lunch", func(t *testing.T) {
		other := testpkg.UniqueTestTenantID(t)
		testpkg.EnsureTestTenant(t, db, other)
		listed, err := cancellations.MealCancellations(testpkg.ContextForTenant(ctx, other), wednesday, wednesday)
		require.NoError(t, err)
		assert.Empty(t, listed)
	})

	t.Run("removing the cancellation lets the booking apply again", func(t *testing.T) {
		require.NoError(t, cancellations.RestoreMeal(ctx, wednesday))
		require.NoError(t, cancellations.RestoreMeal(ctx, wednesday), "removing twice changes nothing")
		list, err := plan.DailyList(ctx, wednesday)
		require.NoError(t, err)
		assert.False(t, list.Closed)
		assert.Equal(t, []int64{student.ID}, dailyParticipantIDs(list))
		assert.Equal(t, bookedDays, mealDays())
	})
}
