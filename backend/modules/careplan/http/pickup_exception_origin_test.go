package careplanhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type pickupOriginException struct {
	ID         string `json:"id"`
	Date       string `json:"exception_date"`
	PickupTime string `json:"pickup_time"`
	Source     string `json:"source"`
	Origin     *struct {
		RequestID      string  `json:"request_id"`
		ApprovedByName string  `json:"approved_by_name"`
		ApprovedAt     *string `json:"approved_at"`
	} `json:"origin"`
}

func readPickupOrigins(t *testing.T, tc *testContext, studentID int64) []pickupOriginException {
	t.Helper()
	req := testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d/pickup-schedules", studentID), nil)
	rr := authExec(t, tc, req, testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var body struct {
		Data struct {
			Exceptions []pickupOriginException `json:"exceptions"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body), rr.Body.String())
	return body.Data.Exceptions
}

// An approved pickup time keeps the parent request it came from (#8209):
// the plan names it with the approver read from the request. A staff edit
// of the day makes the time the school's own, and the origin goes. A
// pointer to a request of another child or another school names nothing.
func TestPickupExceptionKeepsItsApprovedRequest(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, careRequestTodayClock)
	chain := testpkg.CreateTestParentGuardianChain(t, tc.db)
	staff, staffAccount := testpkg.CreateTestStaffWithAccount(t, tc.db, "Paula", "Planerin")
	tenantCtx := tenant.WithTenantID(testpkg.WithPackageTenantRuntime(context.Background()), chain.TenantID)
	date := calendar.NewDate(2026, 9, 15) // a Tuesday inside the request window
	require.NoError(t, tc.resource.PickupScheduleService.UpsertStudentPickupSchedule(tenantCtx, &careplan.PickupSchedule{
		StudentID: chain.StudentID, Weekday: int(date.Weekday()),
		PickupTime: calendar.NormalizeWallClock(time.Date(1, 1, 1, 15, 30, 0, 0, time.UTC)), CreatedBy: staff.ID,
	}))
	pending, err := testpkg.TenantQuery1(t, tenantCtx, tc.db, tc.careRequests.CreatePickupChange, carerequests.PickupChangeCreateInput{
		StudentID: chain.StudentID, GuardianAccountID: chain.AccountID, Date: date,
		PickupTime: time.Date(2000, 1, 1, 14, 30, 0, 0, time.UTC), Reason: "Arzttermin", ReasonRequired: true,
	})
	require.NoError(t, err)

	impact, _ := openWeeklyImpact(t, tc, testutil.AdminTestClaims(int(staffAccount.ID)), chain.StudentID, pending.ID)
	decide, err := http.NewRequest(http.MethodPost, fmt.Sprintf("/care-schedule-change-requests/%d/decide", pending.ID),
		strings.NewReader(fmt.Sprintf(`{"approve":true,"reason":"Passt so","impact_token":%q,"expected_version":%q}`, impact, testpkg.CareRequestVersion(t, pending.ID))))
	require.NoError(t, err)
	decide.Header.Set("Content-Type", "application/json")
	rr := authExec(t, tc, decide, testutil.AdminTestClaims(int(staffAccount.ID)), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	exceptions := readPickupOrigins(t, tc, chain.StudentID)
	require.Len(t, exceptions, 1)
	approved := exceptions[0]
	assert.Equal(t, "14:30", approved.PickupTime)
	assert.Equal(t, careplan.ExceptionSourceStaff, approved.Source, "the approved time stays the school's decision")
	require.NotNil(t, approved.Origin, "the approved time names its parent request")
	assert.Equal(t, fmt.Sprint(pending.ID), approved.Origin.RequestID)
	assert.Equal(t, "Paula Planerin", approved.Origin.ApprovedByName)
	require.NotNil(t, approved.Origin.ApprovedAt)

	t.Run("another child's request names nothing", func(t *testing.T) {
		sibling := testpkg.CreateTestStudent(t, tc.db, "Mia", "Schneider", "2b")
		pointAtRequest(t, tc, insertOriginException(t, tc, sibling.ID, date, staff.ID), pending.ID)
		exceptions := readPickupOrigins(t, tc, sibling.ID)
		require.Len(t, exceptions, 1)
		assert.Nil(t, exceptions[0].Origin)
	})

	t.Run("another school's request names nothing", func(t *testing.T) {
		foreignRequest := foreignSchoolPickupRequest(t, tc, date)
		student := testpkg.CreateTestStudent(t, tc.db, "Ben", "Kaya", "3c")
		pointAtRequest(t, tc, insertOriginException(t, tc, student.ID, date, staff.ID), foreignRequest)
		exceptions := readPickupOrigins(t, tc, student.ID)
		require.Len(t, exceptions, 1)
		assert.Nil(t, exceptions[0].Origin)
	})

	// The school changes the day: the time is now its own entry.
	edit := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/%d/pickup-exceptions/%s", chain.StudentID, approved.ID),
		map[string]any{"exception_date": date.String(), "pickup_time": "13:00", "reason": "Telefonisch geändert"})
	rr = authExec(t, tc, edit, testutil.AdminTestClaims(int(staffAccount.ID)), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	exceptions = readPickupOrigins(t, tc, chain.StudentID)
	require.Len(t, exceptions, 1)
	assert.Equal(t, "13:00", exceptions[0].PickupTime)
	assert.Nil(t, exceptions[0].Origin, "a staff edit ends the origin")
}

func insertOriginException(t *testing.T, tc *testContext, studentID int64, date calendar.Date, staffID int64) int64 {
	t.Helper()
	clock := time.Date(2000, 1, 1, 12, 0, 0, 0, time.UTC)
	row := testpkg.InsertStudentPickupExceptionRow(t, tc.db, testpkg.StudentPickupExceptionRow{
		TenantID: testpkg.Tenant(t), StudentID: studentID, ExceptionDate: date, PickupTime: &clock, CreatedBy: staffID,
	})
	return row.ID
}

// pointAtRequest sets the stored origin directly, as a stale or tampered row
// would carry it.
func pointAtRequest(t *testing.T, tc *testContext, exceptionID, requestID int64) {
	t.Helper()
	_, err := tc.db.ExecContext(context.Background(),
		`UPDATE schedule.student_pickup_exceptions SET source_request_id = ? WHERE id = ?`, requestID, exceptionID)
	require.NoError(t, err)
}

// foreignSchoolPickupRequest approves nothing: it only stores a pickup
// request of a child in a school of its own.
func foreignSchoolPickupRequest(t *testing.T, tc *testContext, date calendar.Date) int64 {
	t.Helper()
	var requestID int64
	t.Run("foreign school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		chain := testpkg.CreateTestParentGuardianChain(t, tc.db)
		ctx := tenant.WithTenantID(testpkg.WithPackageTenantRuntime(context.Background()), chain.TenantID)
		request, err := testpkg.TenantQuery1(t, ctx, tc.db, tc.careRequests.CreatePickupChange, carerequests.PickupChangeCreateInput{
			StudentID: chain.StudentID, GuardianAccountID: chain.AccountID, Date: date,
			PickupTime: time.Date(2000, 1, 1, 14, 0, 0, 0, time.UTC), Reason: "Termin", ReasonRequired: true,
		})
		require.NoError(t, err)
		_, err = tc.db.ExecContext(context.Background(),
			`UPDATE schedule.care_schedule_change_requests SET status = 'approved', reviewed_at = NOW() WHERE id = ?`, request.ID)
		require.NoError(t, err)
		requestID = request.ID
	})
	require.NotZero(t, requestID)
	return requestID
}
