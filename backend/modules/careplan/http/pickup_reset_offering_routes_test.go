package careplanhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A staff Gehzeit on a booked weekday goes back to the Angebots-Gehzeit
// through the route: the stored override is gone and the answer shows the
// child's pickup data without it.
func TestPickupResetToOfferingRemovesTheStaffTimeThroughTheRoute(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t, fixedCalendarClock)
	bookings, err := api.NewBookingMaterializationTestModule(testpkg.NewDatabase(t, tc.db), testpkg.TenantRuntime(t, tc.db),
		api.BookingMaterializationTestOptions{Today: func() calendar.Date { return studentsTestToday }})
	require.NoError(t, err)
	tc.resource.OfferingPickupTimes = bookings.Bookings
	child := testpkg.CreateTestStudent(t, tc.db, "Gehzeit", "Zurueck", "R1")
	fixture := setupCorrectionFixture(t, tc, child.ID, testpkg.Tenant(t), "Zurueck")
	_, err = tc.db.NewUpdate().TableExpr("enrollment.care_offerings").
		Set("pickup_times = ?", map[string]string{"mon": "14:30", "tue": "14:30", "wed": "14:30", "thu": "14:30", "fri": "14:30"}).
		Where("id = ? AND tenant_id = ?", fixture.ganztag.ID, testpkg.Tenant(t)).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Gehzeit", "Leitung")
	claims, perms := testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"}

	staffTime := map[string]any{
		"schedules":        []map[string]any{{"weekday": 1, "pickup_time": "15:45"}},
		"expected_version": weeklyPlanVersion(t, tc, child.ID),
	}
	rr := authExec(t, tc, testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/%d/pickup-schedules", child.ID), staffTime), claims, perms)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Equal(t, 1, staffPickupRows(t, tc, child.ID, 1))

	rr = authExec(t, tc, testutil.NewAuthenticatedRequest(t, http.MethodPost, fmt.Sprintf("/%d/pickup-schedules/reset-offering", child.ID),
		map[string]any{"weekday": 1, "date": studentsTestToday.String()}), claims, perms)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var answer struct {
		Data struct {
			Schedules []struct {
				Weekday    int    `json:"weekday"`
				PickupTime string `json:"pickup_time"`
				Source     string `json:"source"`
			} `json:"schedules"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &answer))
	for _, schedule := range answer.Data.Schedules {
		assert.False(t, schedule.Weekday == 1 && schedule.Source == "staff", "the staff Gehzeit of Monday is gone: %+v", schedule)
	}
	assert.Zero(t, staffPickupRows(t, tc, child.ID, 1))
}

func staffPickupRows(t *testing.T, tc *testContext, studentID int64, weekday int) int {
	t.Helper()
	var rows int
	require.NoError(t, tc.db.NewSelect().TableExpr("schedule.student_pickup_schedules").ColumnExpr("COUNT(*)").
		Where("student_id = ? AND weekday = ? AND source = 'staff'", studentID, weekday).Scan(testpkg.Ctx(t), &rows))
	return rows
}
