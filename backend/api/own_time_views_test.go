package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const ownTimePath = "/api/time-tracking/"

func checkOwnTimeViews(t *testing.T, api *goldenRuntime) {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	staff, account := testpkg.CreateTestStaffWithAccount(t, db, "Own", "TimeViews")
	other, otherAccount := testpkg.CreateTestStaffWithAccount(t, db, "Other", "TimeViews")
	token := testpkg.MintLiveSessionJWT(t, db, testpkg.AdminTestClaimsForTenant(int(account.ID), school))
	counter := testpkg.CaptureQueriesForContext(t, api.db.Pool())
	fixture := ownViewsFixture{t: t, db: db, staff: staff.ID, school: school}
	now := testpkg.DatabaseNow(t, db)
	today := calendar.DateFromTime(now)
	first := calendar.NewDate(2025, time.October, 1)
	last := first.AddDays(30)
	anchor := first.AddDays(1)
	holiday := first.AddDays(2)
	closure := first.AddDays(5)
	week := first.StartOfISOWeek()
	weekEnd := week.AddDays(6)
	testpkg.SetTestTenantSetting(t, db, school, records.KeyTimeTrackingAccountStartDate, strconv.Quote(anchor.String()))
	testpkg.SetTestTenantSetting(t, db, school, records.KeyFederalState, `"DE-NW"`)
	testpkg.SetTestTenantSetting(t, db, school, records.KeyModuleZeiterfassung, "true")
	testpkg.SetTestTenantSetting(t, db, school, records.KeyModuleDienstplan, "true")
	testpkg.CreateTestClosingDay(t, db, closure, closure.AddDays(1), "Staff training")

	wed := testpkg.CreateTestStaffWorkScheduleForTenant(t, db, school, staff.ID, 2, 240, first.AddDays(-7))
	change := first.AddDays(14)
	_, err := db.NewRaw("UPDATE config.staff_work_schedules SET valid_until = ? WHERE id = ?", change, wed.ID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	testpkg.CreateTestStaffWorkScheduleForTenant(t, db, school, staff.ID, 2, 360, change)
	testpkg.CreateTestStaffWorkScheduleForTenant(t, db, school, staff.ID, 0, 240, first)
	testpkg.CreateTestStaffWorkScheduleForTenant(t, db, school, staff.ID, 3, 240, first)
	testpkg.CreateTestStaffWorkScheduleForTenant(t, db, school, staff.ID, 4, 240, first)
	halfDay := first.AddDays(8)
	fixture.absence(halfDay, halfDay, now.Add(-time.Hour), workforce.AbsenceTypeSick, workforce.AbsenceStatusReported, true, "Half day")

	start := first.BerlinMidnight()
	nightEnd := start.Add(2 * time.Hour)
	night := fixture.session(first.AddDays(-1), start.Add(-2*time.Hour), &nightEnd, "Night block")
	dayEnd := start.Add(11 * time.Hour)
	fixture.session(first, start.Add(8*time.Hour), &dayEnd, "Day block")
	openAt := now.Add(-time.Hour)
	open := fixture.session(calendar.DateFromTime(openAt), openAt, nil, "Running block")
	fixture.pause(open, now.Add(-30*time.Minute))
	cancelled := testpkg.CreateTestStaffShift(t, db, other.ID, today, testpkg.StaffShiftOpts{Cancelled: true})
	testpkg.CreateTestStaffShiftChange(t, db, staff.ID, today, testpkg.StaffShiftChange{Covers: &cancelled.ID})
	testpkg.CreateTestStaffShift(t, db, staff.ID, today, testpkg.StaffShiftOpts{StartHHMM: "16:00", EndHHMM: "19:00", Cancelled: true})
	testpkg.CreateTestStaffShift(t, db, staff.ID, first.AddDays(22), testpkg.StaffShiftOpts{})
	room := testpkg.CreateTestRoom(t, db, "Time views room")
	block := testpkg.CreateTestActivityInstance(t, db, today, room.ID, testpkg.ActivityInstanceOpts{Title: "Today's assignment"})
	testpkg.CreateTestInstanceStaff(t, db, block.ID, staff.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})

	yearStart := calendar.NewDate(today.Year(), time.January, 1)
	yearEnd := calendar.NewDate(today.Year(), time.December, 31)
	custom := testpkg.CreateTestStaffAbsenceType(t, db, "Additional leave")
	_, err = db.NewRaw("UPDATE active.staff_absence_types SET requestable = true, allowance_enabled = true WHERE id = ?", custom.ID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	question := fixture.absence(yearStart.AddDays(-2), yearStart.AddDays(-1), now.Add(-time.Hour), workforce.AbsenceTypeVacation, workforce.AbsenceStatusQuestion, false, "Previous year question")
	otherFixture := ownViewsFixture{t: t, db: db, staff: other.ID, school: school}
	otherFixture.absence(today, today, now, workforce.AbsenceTypeVacation, workforce.AbsenceStatusQuestion, false, "Other request is private")

	get := func(path string) (*httptest.ResponseRecorder, testpkg.QueryMeasurement) {
		counter.Reset()
		rec := checkpointRequest(api.queryBudgetHandler(counter), checkpointScenario{Method: http.MethodGet, Path: path, Authenticated: true}, token)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return rec, counter.Measurement(counter.Queries())
	}
	weekRange, monthRange := ownTimeRange(week, weekEnd), ownTimeRange(first, last)
	clockRange := ownTimeRange(today.AddDays(-14), today.StartOfISOWeek().AddDays(6))
	currentWeek := ownTimeRange(today.StartOfISOWeek(), today.StartOfISOWeek().AddDays(6))
	todayRange := ownTimeRange(today, today)
	monthSummary := fmt.Sprintf("month-summary?year=%d&month=%d", today.Year(), today.Month())
	periodReads := func(historyRange, selectedRange string) []string {
		return []string{"history" + historyRange, "absences" + selectedRange, "shifts" + selectedRange,
			"schedule-targets" + selectedRange, "holidays" + selectedRange, "closing-days" + selectedRange}
	}
	routes := []struct {
		name string
		path string
		old  []string
	}{
		{"week", "period?view=week&start=" + week.String(), periodReads(weekRange, weekRange)},
		{"month", "period?view=month&start=" + first.String(), append(periodReads(ownTimeRange(week, last.StartOfISOWeek().AddDays(6)), monthRange), "month-summary?year=2025&month=10")},
		{"overview", "overview", []string{"current", "history" + clockRange, "absences" + clockRange, "shifts" + todayRange,
			"schedule-targets" + currentWeek, monthSummary, "config", "assignments" + todayRange, fmt.Sprintf("breaks/%d", open),
			fmt.Sprintf("/api/staff/%d/schedule", staff.ID)}},
		{"leave_overview", "leave-overview", []string{"vacation/quota", "absences" + ownTimeRange(yearStart, yearEnd),
			"absences?status=question", "absence-allowances", "absences/mails"}},
	}

	_, enqueue, err := WorkforceMailOutboxForTests(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	var waiting int64
	added := 0
	firstSQL := make(map[string]int)
	for _, size := range []int{3, 9} {
		for ; added < size; added++ {
			day := first.AddDays(added%3 + 2)
			closedAt := day.BerlinMidnight().Add(time.Duration(12+3*(added/3)) * time.Hour)
			fixture.session(day, closedAt.Add(-2*time.Hour), &closedAt, "October history")
			recent := today.AddDays(-added - 1)
			recentEnd := recent.BerlinMidnight().Add(12 * time.Hour)
			fixture.session(recent, recentEnd.Add(-2*time.Hour), &recentEnd, "Clock history")
			date := yearEnd.AddDays(-added)
			kind := workforce.AbsenceTypeVacation
			if added%3 == 2 {
				kind = workforce.AbsenceTypeOther
			}
			waiting = fixture.absence(date, date, now.Add(time.Duration(added)*time.Minute), kind, workforce.AbsenceStatusRequested, false, "Waiting request")
			if kind == workforce.AbsenceTypeOther {
				_, err := db.NewRaw("UPDATE active.staff_absences SET absence_type_id = ? WHERE id = ?", custom.ID, waiting).Exec(testpkg.Ctx(t))
				require.NoError(t, err)
			}
			require.NoError(t, testpkg.RunInTenantTransaction(testpkg.Ctx(t), func(ctx context.Context) error {
				return enqueue(ctx, workforce.AbsenceMailRequestReceived, waiting, account.Email)
			}))
		}
		for _, route := range routes {
			rec, measured := get(ownTimePath + route.path)
			if count, seen := firstSQL[route.name]; seen {
				require.Len(t, measured.Statements, count, "%s must not query per row", route.name)
			} else {
				firstSQL[route.name] = len(measured.Statements)
			}
			switch route.name {
			case "week":
				querybudgets.AssertQueryBudget(t, "workforce.own_time_views.week", measured)
			case "month":
				querybudgets.AssertQueryBudget(t, "workforce.own_time_views.month", measured)
			case "overview":
				querybudgets.AssertQueryBudget(t, "workforce.own_time_views.overview", measured)
			case "leave_overview":
				querybudgets.AssertQueryBudget(t, "workforce.own_time_views.leave_overview", measured)
			}
			var beforeSQL, beforeBytes int
			for _, path := range route.old {
				if !strings.HasPrefix(path, "/api/") {
					path = ownTimePath + path
				}
				old, queries := get(path)
				beforeSQL += len(queries.Statements)
				beforeBytes += old.Body.Len()
			}
			t.Logf("own %s N=%d: SQL %d → %d, JSON bytes %d → %d", route.name, size, beforeSQL, len(measured.Statements), beforeBytes, rec.Body.Len())
			require.Less(t, len(measured.Statements), beforeSQL)
			require.LessOrEqual(t, rec.Body.Len(), beforeBytes)
		}
	}

	periodRec, _ := get(ownTimePath + routes[1].path)
	period := ownTimeViewData[workforce.OwnTimePeriod](t, periodRec)
	require.Equal(t, first, period.Start)
	require.Equal(t, last, period.End)
	require.Equal(t, week, period.WeekStart)
	require.Equal(t, anchor, period.AccountStart)
	require.Contains(t, period.Holidays, workforce.OwnTimeHoliday{Date: holiday, Name: "Tag der Deutschen Einheit"})
	require.Equal(t, closure, period.ClosingDays[0].StartDate)
	require.Equal(t, 0, period.Days[0].ActualMinutes, "before the mid-month account start")
	require.Equal(t, 0, period.Days[2].TargetMinutes, "statutory holiday")
	require.Equal(t, 0, period.Days[first.DaysUntil(closure)].TargetMinutes, "school closure")
	require.Equal(t, 120, period.Days[first.DaysUntil(halfDay)].CreditMinutes, "half of that day's target")
	require.Equal(t, 360, period.Days[first.DaysUntil(change)].TargetMinutes, "the new version applies from its actual start")
	require.NotNil(t, period.MonthSummary)
	require.Equal(t, workforce.OwnReadReady, period.MonthSummary.PlannedShiftState)
	require.NotNil(t, period.MonthSummary.PlannedShiftMinutes)
	require.Equal(t, 480, *period.MonthSummary.PlannedShiftMinutes)
	legacyMonth, _ := get(ownTimePath + "month-summary?year=2025&month=10")
	require.Equal(t, ownTimeViewData[workforce.MonthSummary](t, legacyMonth), period.MonthSummary.MonthSummary)
	require.Contains(t, period.RestHints, workforce.OwnTimeRestHint{Date: first, RestMinutes: 360, LimitMinutes: 660})
	pos := slices.IndexFunc(period.Sessions, func(block workforce.OwnTimeBlock) bool { return block.ID == ident.ID(night) })
	require.GreaterOrEqual(t, pos, 0, "month includes the block from September")
	oldHistory, _ := get(ownTimePath + "history" + ownTimeRange(week, period.WeekEnd))
	oldBlocks := ownTimeViewData[oldTimeHistory](t, oldHistory)
	oldPos := slices.IndexFunc(oldBlocks.Sessions, func(block oldTimeBlock) bool { return block.ID == ident.ID(night) })
	require.GreaterOrEqual(t, oldPos, 0)
	require.Equal(t, oldBlocks.Sessions[oldPos].Version, period.Sessions[pos].Version)

	overviewRec, _ := get(ownTimePath + "overview?staff_id=" + strconv.FormatInt(other.ID, 10))
	overview := ownTimeViewData[workforce.OwnClockOverview](t, overviewRec)
	require.Equal(t, ident.ID(staff.ID), overview.StaffID)
	require.NotNil(t, overview.Session)
	require.Equal(t, ident.ID(open), overview.Session.ID)
	require.Len(t, overview.Session.Breaks, 1)
	require.Len(t, overview.Chart, 10)
	require.Len(t, overview.Shifts.Rows, 2)
	require.Equal(t, ident.ID(cancelled.ID), *overview.Shifts.Rows[0].OriginShiftID)
	require.True(t, overview.Shifts.Rows[1].Cancelled)
	require.Len(t, overview.Assignments.Rows, 1)
	require.Equal(t, ident.ID(block.ID), overview.Assignments.Rows[0].InstanceID)
	leaveRec, _ := get(ownTimePath + "leave-overview")
	leave := ownTimeViewData[workforce.OwnLeaveOverview](t, leaveRec)
	require.Equal(t, 9, leave.Counts.Reserved)
	require.Len(t, leave.Recent, 8)
	require.Len(t, leave.Questions, 1)
	require.Equal(t, ident.ID(question), leave.Questions[0].ID)
	require.Equal(t, "Additional leave", leave.Recent[0].AbsenceTypeLabel)
	require.Len(t, leave.Allowances, 1)
	require.Equal(t, ident.ID(custom.ID), leave.Allowances[0].AbsenceTypeID)
	require.Equal(t, map[string]int{"queued": 1}, leave.Mails.Absences[ident.ID(waiting)])
	require.NotContains(t, leaveRec.Body.String(), "Other request is private")

	checkOwnTimeViewAccess(t, api, fixture, account.ID, otherAccount.ID, today, token)
}

type oldTimeBlock struct {
	ID      ident.ID `json:"id"`
	Version string   `json:"version"`
}
type oldTimeHistory struct {
	Sessions []oldTimeBlock `json:"sessions"`
}

func ownTimeRange(from, to calendar.Date) string {
	return "?from=" + from.String() + "&to=" + to.String()
}

func ownTimeViewData[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope struct {
		Data T `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	return envelope.Data
}

type ownViewsFixture struct {
	t             *testing.T
	db            *bun.DB
	staff, school int64
}

func (f ownViewsFixture) session(day calendar.Date, in time.Time, out *time.Time, note string) int64 {
	f.t.Helper()
	var id int64
	require.NoError(f.t, f.db.NewRaw(`INSERT INTO active.work_sessions
		(tenant_id,staff_id,date,check_in_time,check_out_time,created_by,notes)
		VALUES (?,?,?,?,?,?,?) RETURNING id`, f.school, f.staff, day, in, out, f.staff, note).Scan(testpkg.Ctx(f.t), &id))
	return id
}

func (f ownViewsFixture) pause(session int64, startedAt time.Time) {
	f.t.Helper()
	_, err := f.db.NewRaw(`INSERT INTO active.work_session_breaks (tenant_id,session_id,started_at) VALUES (?,?,?)`,
		f.school, session, startedAt).Exec(testpkg.Ctx(f.t))
	require.NoError(f.t, err)
}

func (f ownViewsFixture) absence(from, to calendar.Date, requested time.Time, kind, status string, half bool, note string) int64 {
	f.t.Helper()
	var id int64
	require.NoError(f.t, f.db.NewRaw(`INSERT INTO active.staff_absences
		(tenant_id,staff_id,absence_type,status,date_start,date_end,requested_at,created_by,half_day,note)
		VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`, f.school, f.staff, kind, status, from, to, requested, f.staff, half, note).Scan(testpkg.Ctx(f.t), &id))
	return id
}

func checkOwnTimeViewAccess(t *testing.T, api *goldenRuntime, f ownViewsFixture, account, otherAccount int64, today calendar.Date, token string) {
	t.Helper()
	send := func(path, token string) *httptest.ResponseRecorder {
		return checkpointRequest(api, checkpointScenario{Method: http.MethodGet, Path: ownTimePath + path, Authenticated: true}, token)
	}
	for _, query := range []string{"", "view=day&start=2025-10-01", "view=week&start=2025-10-01", "view=month&start=2025-10-06",
		"view=week&start=2025-02-30", "view=week&start=2025-09-29&start=2025-10-06"} {
		require.Equal(t, http.StatusBadRequest, send("period?"+query, token).Code, query)
	}
	without := testpkg.MintLiveSessionJWT(t, f.db, testpkg.TenantUserTestClaims(int(account), f.school, permissions.TimeTrackingManage))
	other := testpkg.MintLiveSessionJWT(t, f.db, testpkg.TenantUserTestClaims(int(otherAccount), f.school, permissions.TimeTrackingOwn))
	denied := send("overview", without)
	require.Equal(t, http.StatusForbidden, denied.Code)
	require.NotContains(t, denied.Body.String(), "workforce.no_staff_profile")
	rec := send("leave-overview", other)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotContains(t, rec.Body.String(), "Previous year question")
	foreignSchool, _ := testpkg.CreateTestTenant(t, f.db)
	foreignStaff, foreignAccount := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, foreignSchool, "Foreign", "TimeViews")
	testpkg.SetTestTenantSetting(t, f.db, foreignSchool, records.KeyModuleZeiterfassung, "true")
	foreign := testpkg.MintLiveSessionJWT(t, f.db, testpkg.TenantUserTestClaims(int(foreignAccount.ID), foreignSchool, permissions.TimeTrackingOwn))
	rec = send("overview?staff_id="+strconv.FormatInt(f.staff, 10), foreign)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	foreignOverview := ownTimeViewData[workforce.OwnClockOverview](t, rec)
	require.Equal(t, ident.ID(foreignStaff.ID), foreignOverview.StaffID)
	require.Nil(t, foreignOverview.Session)

	testpkg.SetTestTenantSetting(t, f.db, f.school, records.KeyTimeTrackingAccountStartDate, strconv.Quote(today.AddDays(1).String()))
	testpkg.SetTestTenantSetting(t, f.db, f.school, records.KeyModuleDienstplan, "false")
	rec = send("overview", token)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	overview := ownTimeViewData[workforce.OwnClockOverview](t, rec)
	require.Equal(t, workforce.OwnReadNotBooked, overview.Shifts.State)
	require.Empty(t, overview.Shifts.Rows)
	require.Equal(t, workforce.OwnReadReady, overview.Assignments.State)
	require.Len(t, overview.Assignments.Rows, 1)
	require.Nil(t, overview.AccountBalance)
	rec = send("period?view=month&start=2025-10-01", token)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	month := ownTimeViewData[workforce.OwnTimePeriod](t, rec).MonthSummary
	require.NotNil(t, month)
	require.Equal(t, workforce.OwnReadNotBooked, month.PlannedShiftState)
	require.Nil(t, month.PlannedShiftMinutes)
	testpkg.SetTestTenantSetting(t, f.db, f.school, records.KeyModuleZeiterfassung, "false")
	for _, path := range []string{"period?view=week&start=2025-09-29", "overview", "leave-overview"} {
		rec = send(path, token)
		require.Equal(t, http.StatusForbidden, rec.Code)
		require.Contains(t, rec.Body.String(), "module.not_booked")
	}
	require.Equal(t, http.StatusOK, send("assignments"+ownTimeRange(today, today), token).Code)
}
