//go:build testhooks

package shifttypes_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// Series shifts follow the school's closing days (#8205). The school plans
// Monday to Friday from Monday 14 September 2026, the day the clock is
// pinned to; the series materialize from tomorrow on.
var breakDayToday = calendar.NewDate(2026, 9, 14)

type breakDayEnv struct {
	db       *bun.DB
	calendar schoolcalendar.Calendar
	planning workforce.StaffShiftPlanning
	router   chi.Router
	token    string
	tenant   int64
}

func setupBreakDayEnv(t *testing.T, db *bun.DB) *breakDayEnv {
	t.Helper()
	closingDays, planning, router, err := api.NewClosingDayShiftsTest(testpkg.NewDatabase(t, db), func() calendar.Date { return breakDayToday })
	require.NoError(t, err)
	return &breakDayEnv{
		db: db, calendar: closingDays, planning: planning, tenant: testpkg.Tenant(t), token: managerToken(t, 0),
		router: testpkg.MountedQueryBudgetRouter("/api", testpkg.TenantRuntimeMiddleware(t, db)(router)),
	}
}

func (e *breakDayEnv) inTenant(t *testing.T, tenantID int64, fn func(ctx context.Context) error) {
	t.Helper()
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), e.db, tenantID, func(ctx context.Context, _ bun.Tx) error { return fn(ctx) }))
}

// planSeries plans 08:00–12:00 on every weekday of the period for a new
// staff member of tenantID.
func (e *breakDayEnv) planSeries(t *testing.T, tenantID int64, includeBreaks bool) int64 {
	t.Helper()
	suffix := testpkg.UniqueSuffix()
	staff := testpkg.CreateTestStaffForTenant(t, e.db, tenantID, "Serie", fmt.Sprintf("Schliesstag-%d", suffix))
	period := testpkg.CreateTestWeekCyclePeriodForTenant(t, e.db, tenantID, fmt.Sprintf("Schuljahr-%d", suffix),
		breakDayToday, calendar.NewDate(2026, 10, 2), 1, nil)
	e.inTenant(t, tenantID, func(ctx context.Context) error {
		_, err := e.planning.CreateSeries(ctx, workforce.CreateStaffShiftSeries{StaffShiftSeriesInput: workforce.StaffShiftSeriesInput{
			StaffID: staff.ID, Weekdays: []int{1, 2, 3, 4, 5}, StartTime: "08:00:00", EndTime: "12:00:00",
			CalendarPeriodID: period.ID, ValidFrom: breakDayToday.String(), IncludeSchoolBreaks: includeBreaks, ActorStaffID: staff.ID,
		}})
		return err
	})
	return staff.ID
}

type breakDayShift struct {
	ID           string  `json:"id"`
	Date         string  `json:"date"`
	Cancelled    bool    `json:"cancelled"`
	ChangeReason *string `json:"change_reason"`
}

func (e *breakDayEnv) get(t *testing.T, token, path string, into any) int {
	t.Helper()
	response := testutil.ExecuteRequestForTest(t, e.router, testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, testutil.WithJWTBearer(token)))
	if into != nil && response.Code == http.StatusOK {
		envelope := struct {
			Data json.RawMessage `json:"data"`
		}{}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
		require.NoError(t, json.Unmarshal(envelope.Data, into))
	}
	return response.Code
}

// week reads one person's shifts of 21–25 September through the shift route.
func (e *breakDayEnv) week(t *testing.T, staffID int64) map[string]breakDayShift {
	t.Helper()
	var shifts []breakDayShift
	require.Equal(t, http.StatusOK, e.get(t, e.token, fmt.Sprintf("/staff-shifts/?from=2026-09-21&to=2026-09-25&staff_id=%d", staffID), &shifts))
	byDate := make(map[string]breakDayShift, len(shifts))
	for _, shift := range shifts {
		byDate[shift.Date] = shift
	}
	require.Len(t, byDate, 5, "one shift per weekday")
	return byDate
}

func (e *breakDayEnv) breakDayShifts(t *testing.T) []workforce.SeriesBreakDayShift {
	t.Helper()
	var shifts []workforce.SeriesBreakDayShift
	require.Equal(t, http.StatusOK, e.get(t, e.token, "/staff-shifts/break-day-shifts", &shifts))
	return shifts
}

func reasonOf(shift breakDayShift) string {
	if shift.ChangeReason == nil {
		return ""
	}
	return *shift.ChangeReason
}

// A closing day entered after the plan cancels the unchanged series shifts
// of its days with a neutral reason; deleting it plans them again. A shift
// changed by hand stays and is listed; a series planned for closing days and
// another school's plan stay untouched.
func TestClosingDayCancelsAndRestoresUnchangedSeriesShifts(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	env := setupBreakDayEnv(t, db)
	staffID := env.planSeries(t, env.tenant, false)
	includingBreaks := env.planSeries(t, env.tenant, true)
	foreign := testpkg.NewTenantScope(t, db)
	env.planSeries(t, foreign.TenantID, false)
	env.inTenant(t, foreign.TenantID, func(ctx context.Context) error {
		_, err := env.calendar.CreateClosingDay(ctx, schoolcalendar.CreateClosingDay{ClosingDayFields: schoolcalendar.ClosingDayFields{
			StartDate: "2026-09-22", EndDate: "2026-09-22", Reason: "Fortbildung der anderen Schule",
		}})
		return err
	})

	// Thursday's shift is changed by hand before the closing day exists.
	before := env.week(t, staffID)
	adjustedID, err := strconv.ParseInt(before["2026-09-24"].ID, 10, 64)
	require.NoError(t, err)
	env.inTenant(t, env.tenant, func(ctx context.Context) error {
		_, err := env.planning.UpdateShift(ctx, workforce.UpdateStaffShift{ID: adjustedID, StaffShiftInput: workforce.StaffShiftInput{
			StaffID: staffID, Date: "2026-09-24", StartTime: "09:00:00", EndTime: "12:00:00", ActorStaffID: staffID,
		}})
		return err
	})

	var closingDay schoolcalendar.ClosingDay
	env.inTenant(t, env.tenant, func(ctx context.Context) error {
		closingDay, err = env.calendar.CreateClosingDay(ctx, schoolcalendar.CreateClosingDay{ClosingDayFields: schoolcalendar.ClosingDayFields{
			StartDate: "2026-09-23", EndDate: "2026-09-24", Reason: "Pädagogischer Tag",
		}})
		return err
	})

	closed := env.week(t, staffID)
	assert.True(t, closed["2026-09-23"].Cancelled, "the unchanged shift on the closing day is cancelled")
	assert.Equal(t, workforce.ClosingDayShiftChangeReason, reasonOf(closed["2026-09-23"]), "with the neutral reason")
	assert.False(t, closed["2026-09-24"].Cancelled, "the shift changed by hand stays planned")
	assert.False(t, closed["2026-09-22"].Cancelled, "the other days stay planned")
	for date, shift := range env.week(t, includingBreaks) {
		assert.False(t, shift.Cancelled, "a series planned for closing days keeps %s", date)
	}
	listed := env.breakDayShifts(t)
	require.Len(t, listed, 1, "only the adjusted shift of this school stands on a closing day: %+v", listed)
	assert.Equal(t, workforce.SeriesBreakDayShift{
		ShiftID: ident.ID(adjustedID), StaffID: ident.ID(staffID), Date: "2026-09-24", StartTime: "09:00", EndTime: "12:00",
		Break: workforce.BreakDayClosingDay, Adjusted: true,
	}, listed[0])

	env.inTenant(t, env.tenant, func(ctx context.Context) error { return env.calendar.DeleteClosingDay(ctx, closingDay.ID) })

	reopened := env.week(t, staffID)
	assert.False(t, reopened["2026-09-23"].Cancelled, "deleting the closing day plans the shift again")
	assert.Empty(t, reasonOf(reopened["2026-09-23"]), "and drops the closing day's reason")
	assert.Equal(t, closed["2026-09-23"].ID, reopened["2026-09-23"].ID, "the same shift returns")
	assert.Empty(t, env.breakDayShifts(t), "no shift stands on a closing day any more")
}

// The list is behind the Dienstplan's planning right, and its statements do
// not grow with the shifts it lists.
func TestBreakDayShiftsNeedThePlanningRightAndStayFlat(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	env := setupBreakDayEnv(t, db)
	claims := testutil.DefaultTestClaims()
	claims.TenantID = env.tenant
	claims.Permissions = []string{"schedules:read"}
	claims.IsAdmin = false
	require.Equal(t, http.StatusForbidden, env.get(t, testutil.MintTestJWT(t, claims), "/staff-shifts/break-day-shifts", nil))

	counter := testpkg.CaptureQueries(t, db)
	var previous int
	var closingDayID int64
	for round, people := range []int{1, 3} {
		// A new series leaves an existing closing day out, so every round
		// plans and adjusts its people on an open day and closes it after.
		if closingDayID != 0 {
			env.inTenant(t, env.tenant, func(ctx context.Context) error { return env.calendar.DeleteClosingDay(ctx, closingDayID) })
		}
		for i := 0; i < people-round; i++ {
			staffID := env.planSeries(t, env.tenant, false)
			week := env.week(t, staffID)
			id, err := strconv.ParseInt(week["2026-09-24"].ID, 10, 64)
			require.NoError(t, err)
			env.inTenant(t, env.tenant, func(ctx context.Context) error {
				_, err := env.planning.UpdateShift(ctx, workforce.UpdateStaffShift{ID: id, StaffShiftInput: workforce.StaffShiftInput{
					StaffID: staffID, Date: "2026-09-24", StartTime: "09:00:00", EndTime: "12:00:00", ActorStaffID: staffID,
				}})
				return err
			})
		}
		env.inTenant(t, env.tenant, func(ctx context.Context) error {
			day, err := env.calendar.CreateClosingDay(ctx, schoolcalendar.CreateClosingDay{ClosingDayFields: schoolcalendar.ClosingDayFields{
				StartDate: "2026-09-24", EndDate: "2026-09-24", Reason: "Betriebsausflug",
			}})
			closingDayID = day.ID
			return err
		})
		counter.Reset()
		request := httptest.NewRequest(http.MethodGet, "/staff-shifts/break-day-shifts", nil)
		request.Header.Set("Authorization", "Bearer "+env.token)
		recorder := httptest.NewRecorder()
		env.router.ServeHTTP(recorder, request)
		queries := counter.Measurement(counter.Queries())
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		var envelope struct {
			Data []workforce.SeriesBreakDayShift `json:"data"`
		}
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
		require.Len(t, envelope.Data, people)
		require.Zero(t, counter.WriteRows(), "the list writes nothing")
		if round > 0 {
			require.Len(t, queries.Statements, previous, "the statements do not grow with the listed shifts")
		}
		previous = len(queries.Statements)
		querybudgets.AssertQueryBudget(t, "api.workforce.staff_shifts.break_day_shifts", queries)
	}
}
