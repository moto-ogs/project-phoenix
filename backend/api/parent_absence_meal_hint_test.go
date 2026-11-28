package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	portalCompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
	"github.com/stretchr/testify/require"
)

// The meal registration of a day is a copy beside the care day (#8216,
// spec #8212): an absence the school applies at once cancels the meal on
// its own, an absence waiting for the school does not. The parents portal
// reads the day after the absence and offers „Auch abmelden“; these tests
// pin what that hint reads and writes through the parent routes.

// absenceMealRig serves the parent routes on the meal rig's fixed clock,
// with the status days a sick note writes.
type absenceMealRig struct {
	childReadRig
}

func newAbsenceMealRig(t *testing.T) absenceMealRig {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	people := NewPeopleRepositorySuiteFactory(database)
	meals, err := owners.BuildMealPlanAtForTests(database, settings.Settings, owners.NewStudentRootReads(people.Student), owners.MustNewPeopleDirectory(database), nil, mealWriteNow)
	require.NoError(t, err)
	return absenceMealRig{newChildReadRigOn(t, db, func(deps *portalCompose.Dependencies) {
		deps.Now = mealWriteNow
		deps.MealPlan = meals
		deps.StatusDayRepo = NewRepositoryTestFactory(database).StudentStatusDay
	})}
}

// mealFamily is a child in care since August with meals on every weekday.
func (r absenceMealRig) mealFamily(t *testing.T) childReadFamily {
	t.Helper()
	f := r.family(t)
	from := calendar.NewDate(2026, 8, 1)
	testpkg.SetStudentLifecycle(t, r.db, f.StudentID, "active", &from, nil)
	_, err := r.db.NewRaw(`INSERT INTO schedule.meal_participation_schedules (tenant_id, student_id, effective_from, monday, tuesday, wednesday, thursday, friday, changed_by_account_id) VALUES (?, ?, ?, true, true, true, true, true, ?)`,
		f.TenantID, f.StudentID, from, f.AccountID).Exec(context.Background())
	require.NoError(t, err)
	return f
}

func (r absenceMealRig) setting(t *testing.T, key string, value any) {
	t.Helper()
	require.NoError(t, r.settings.SetValue(testpkg.Ctx(t), key, value, nil, nil))
}

// do answers one parent request as "<status>" or "<status> <code>".
func (r absenceMealRig) do(t *testing.T, w writeCall, token string) string {
	t.Helper()
	req := testutil.NewAuthenticatedRequest(t, w.method, w.path, w.body, testutil.WithJWTBearer(token))
	return strings.TrimSpace(answer(t, testutil.ExecuteRequest(r.router, req)))
}

// mealDayState is one day of the parent's meal participation read.
type mealDayState struct {
	Date          string `json:"date"`
	Participating bool   `json:"participating"`
	Source        string `json:"source"`
	CanCancel     bool   `json:"can_cancel"`
}

// mealDayRead reads the child's meal day as the parents portal does, with
// the given parent's token.
func (r absenceMealRig) mealDayRead(t *testing.T, studentID int64, token string, date calendar.Date) (int, mealDayState) {
	t.Helper()
	path := fmt.Sprintf("/parent/me/children/%d/meal-participation?from=%s&to=%s", studentID, date, date)
	rec := testutil.ExecuteRequest(r.router, testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, testutil.WithJWTBearer(token)))
	if rec.Code != http.StatusOK {
		return rec.Code, mealDayState{}
	}
	var read struct {
		Data struct {
			Days []mealDayState `json:"days"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &read))
	for _, day := range read.Data.Days {
		if day.Date == date.String() {
			return rec.Code, day
		}
	}
	t.Fatalf("meal participation has no day %s: %s", date, rec.Body.String())
	return 0, mealDayState{}
}

func absenceNote(studentID int64, date calendar.Date, status string) writeCall {
	return writeCall{http.MethodPost, fmt.Sprintf("/parent/me/children/%d/sick-note", studentID), map[string]any{"dates": []string{date.String()}, "status": status, "reason": "Termin"}}
}

// TestParentAbsenceLeavesAPendingDaysMealRegistered: the source (the care
// day) changes and the target either follows or names the copy.
func TestParentAbsenceLeavesAPendingDaysMealRegistered(t *testing.T) {
	t.Parallel()
	rig := newAbsenceMealRig(t)
	f := rig.mealFamily(t)
	rig.setting(t, settingsModule.KeyParentSickRequiresApproval, false)
	rig.setting(t, settingsModule.KeyParentExcusedRequiresApproval, true)

	// The day eats before anything is reported, and the parent may still
	// cancel it: tomorrow's deadline lies ahead.
	code, day := rig.mealDayRead(t, f.StudentID, f.token, mealWriteTuesday)
	require.Equal(t, http.StatusOK, code)
	require.True(t, day.Participating)
	require.True(t, day.CanCancel)

	// A sick note the school applies at once: the meal follows.
	require.Equal(t, "201", rig.do(t, absenceNote(f.StudentID, mealWriteTuesday, "sick"), f.token))
	_, day = rig.mealDayRead(t, f.StudentID, f.token, mealWriteTuesday)
	require.False(t, day.Participating, "an applied absence cancels the meal")
	require.Equal(t, "sick", day.Source)

	// An excuse waiting for the school: the care day is cancelled for the
	// parent, the meal stays registered and can be cancelled.
	require.Equal(t, "201", rig.do(t, absenceNote(f.StudentID, mealWriteWednesday, "excused"), f.token))
	_, day = rig.mealDayRead(t, f.StudentID, f.token, mealWriteWednesday)
	require.True(t, day.Participating, "a pending absence leaves the meal registered")
	require.True(t, day.CanCancel)

	// „Auch abmelden“ cancels that day's meal with the parent's right.
	require.Equal(t, "200", rig.do(t, mealDay(f.StudentID, mealWriteWednesday, false), f.token))
	_, day = rig.mealDayRead(t, f.StudentID, f.token, mealWriteWednesday)
	require.False(t, day.Participating)
	require.Equal(t, "override", day.Source)
	_, day = rig.mealDayRead(t, f.StudentID, f.token, mealWriteThursday)
	require.True(t, day.Participating, "only the cancelled day changes")
}

// TestParentAbsenceMealHintKeepsItsBoundaries: the hint reads and writes
// only where the parent's relationship and the deadline allow it.
func TestParentAbsenceMealHintKeepsItsBoundaries(t *testing.T) {
	t.Parallel()
	rig := newAbsenceMealRig(t)
	f := rig.mealFamily(t)
	other := rig.mealFamily(t)
	rig.setting(t, settingsModule.KeyParentExcusedRequiresApproval, true)
	require.Equal(t, "201", rig.do(t, absenceNote(f.StudentID, childReadToday, "excused"), f.token))

	// Today's deadline has passed: the meal stays, the parent cannot cancel
	// it any more and the write is refused.
	_, day := rig.mealDayRead(t, f.StudentID, f.token, childReadToday)
	require.True(t, day.Participating)
	require.False(t, day.CanCancel)
	require.Equal(t, "409 meals.participation_cutoff_passed", rig.do(t, mealDay(f.StudentID, childReadToday, false), f.token))

	// A parent of another child neither reads nor cancels this child's meal.
	code, _ := rig.mealDayRead(t, f.StudentID, other.token, mealWriteWednesday)
	require.NotEqual(t, http.StatusOK, code)
	require.NotEqual(t, "200", rig.do(t, mealDay(f.StudentID, mealWriteWednesday, false), other.token))

	// Without the relationship's meal right the cancellation is refused.
	_, err := rig.db.NewRaw(`UPDATE auth.guardian_student_access SET permissions = permissions - ? WHERE account_id = ?`, "parent_portal.meal_participation.manage", f.AccountID).Exec(context.Background())
	require.NoError(t, err)
	require.Equal(t, "403 meals.participation_manage_denied", rig.do(t, mealDay(f.StudentID, mealWriteWednesday, false), f.token))
	_, day = rig.mealDayRead(t, f.StudentID, f.token, mealWriteWednesday)
	require.True(t, day.Participating, "no refused write changed the day")
}
