package classdayhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/classday"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

func TestAssignedClassesAPI(t *testing.T) {
	t.Parallel()
	db, router := setupClassDayRoute(t)
	const root = "/school/class-day"
	mounted := testpkg.MountedQueryBudgetRouter(root, router)
	counter := testpkg.CaptureQueriesForContext(t, db)
	staff, account := testpkg.CreateTestStaffWithAccount(t, db, "Assigned", "Teacher")
	claims := sessiontoken.AppClaims{
		ID: int(account.ID), Sub: account.Email, Roles: []string{"lehrkraft"},
		TenantID: testpkg.Tenant(t), Scope: tenant.ScopeSchool,
	}
	get := func(path string, friday bool, perms ...string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req = req.WithContext(calendar.WithWeekendPlan(counter.Context(req.Context()), func(context.Context) (bool, error) {
			return friday, nil
		}))
		return testutil.ExecuteWithAuthPermissions(t, mounted, req, claims, perms)
	}
	overview := func(date calendar.Date, friday bool) (*httptest.ResponseRecorder, classday.AssignedClassesReport) {
		t.Helper()
		rec := get("/assigned-classes?date="+date.String(), friday, classDayReadPermission)
		return rec, assignedClassesData[classday.AssignedClassesReport](t, rec)
	}

	day := calendar.NewDate(2026, 8, 5)
	testpkg.CreateTestEnrollmentPhaseAround(t, db, day)
	foreignID, _ := testpkg.CreateTestTenant(t, db)
	testpkg.CreateTestStudentForTenant(t, db, foreignID, "Foreign", "SameClass", "Overview 1")
	testpkg.CreateTestStudent(t, db, "Unassigned", "Child", "Other class")
	_, empty := overview(day, false)
	require.NotNil(t, empty.Classes)
	assert.Empty(t, empty.Classes)
	assert.Equal(t, http.StatusForbidden, get("/assigned-classes", false, "users:read").Code)
	assert.Equal(t, http.StatusBadRequest, get("/assigned-classes?date=05.08.2026", false, classDayReadPermission).Code)

	classes := []string{"Overview 1", "Overview 2", "Overview 3", "Overview 4", "Overview 5", "Overview 6"}
	var firstID int64
	for i, class := range classes {
		if i == 5 {
			continue // An assigned class can have no children.
		}
		child := testpkg.CreateTestStudent(t, db, fmt.Sprintf("Child%d", i), "FullSheetOnly", class)
		if i == 0 {
			firstID = child.ID
		}
	}
	testpkg.CreateTestClassListEntry(t, db, "List", "FullSheetOnly", classes[0])

	var firstCount int
	var assignments []int64
	for _, count := range []int{1, 3, 6} {
		for _, class := range classes[len(assignments):count] {
			assignment := testpkg.CreateTestClassTeacher(t, db, staff.ID, class)
			assignments = append(assignments, assignment.ID)
		}
		// Fresh report date for each legacy comparison, including its audit write.
		date := day.AddDays((count - 1) * 7)
		counter.Reset()
		rec, report := overview(date, false)
		require.Len(t, report.Classes, count)
		assert.True(t, report.EnrollmentKnown)
		assert.Equal(t, 2, report.Classes[0].Totals.Students, "only this school's own roster and list entry")
		for _, private := range []string{"FullSheetOnly", "SameClass", "Other class", "student_id", "first_name", "rows"} {
			assert.NotContains(t, rec.Body.String(), private)
		}
		var shape struct {
			Data struct {
				Classes []map[string]json.RawMessage `json:"classes"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &shape))
		for _, summary := range shape.Data.Classes {
			// The trips of the class (#8155) are counts per return time too.
			assert.Len(t, summary, 4)
			assert.Contains(t, summary, "totals")
			assert.Contains(t, summary, "changes")
			assert.Contains(t, summary, "school_class")
			assert.JSONEq(t, `[]`, string(summary["trips"]))
		}
		statements := counter.Total()
		if count == 1 {
			firstCount = statements
		}
		assert.Equal(t, firstCount, statements, "statements do not grow per class")
		querybudgets.AssertQueryBudget(t, "modules.classday.assigned_classes", counter.Measurement(counter.Queries()))

		counter.Reset()
		oldList := get("/classes", false, classDayReadPermission)
		require.Equal(t, http.StatusOK, oldList.Code)
		oldBytes := oldList.Body.Len()
		for i, class := range classes[:count] {
			full := get("/?class="+url.QueryEscape(class)+"&date="+date.String(), false, classDayReadPermission)
			detail := assignedClassesData[classday.DayReport](t, full)
			assert.Equal(t, class, report.Classes[i].SchoolClass)
			assert.Equal(t, detail.Totals, report.Classes[i].Totals)
			assert.Equal(t, sheetChanges(detail), report.Classes[i].Changes)
			oldBytes += full.Body.Len()
		}
		t.Logf("assigned=%d old={gets:%d bytes:%d statements:%d} new={gets:1 bytes:%d statements:%d}",
			count, count+1, oldBytes, counter.Total(), rec.Body.Len(), statements)
		assert.Less(t, rec.Body.Len(), oldBytes)
	}

	var logged int
	require.NoError(t, db.NewSelect().TableExpr("audit.data_access_log").
		Where("actor_account_id = ? AND resource_type = 'class_day_view'", account.ID).
		ColumnExpr("count(*)").Scan(testpkg.Ctx(t), &logged))
	assert.Equal(t, 10, logged, "only the ten opened class sheets log individual disclosures")

	testpkg.CreateTestStudentStatusDay(t, db, firstID, day, "sick")
	_, late := overview(day, false)
	assert.Equal(t, 1, late.Classes[0].Totals.Absent)
	assert.Equal(t, 1, late.Classes[0].Changes)
	assert.Equal(t, 1, late.Classes[0].Totals.ListEntries)
	assert.Equal(t, classday.DayTotals{}, late.Classes[5].Totals)

	saturday := calendar.NewDate(2026, 8, 8)
	_, closed := overview(saturday, false)
	assert.False(t, closed.SchoolDay)
	assert.Empty(t, closed.Weekday)
	assert.Equal(t, classday.DayTotals{Students: 2}, closed.Classes[0].Totals)
	_, friday := overview(saturday, true)
	assert.True(t, friday.SchoolDay)
	assert.Equal(t, "fri", friday.Weekday)
	assert.Equal(t, classday.DayTotals{Students: 2, Leaving: 1, ListEntries: 1}, friday.Classes[0].Totals)
	sheet := assignedClassesData[classday.DayReport](t, get("/?class="+url.QueryEscape(classes[0])+"&date="+saturday.String(), true, classDayReadPermission))
	assert.Equal(t, sheet.Totals, friday.Classes[0].Totals)
	assert.Equal(t, sheetChanges(sheet), friday.Classes[0].Changes)

	// The later phase overlaps the original one. Only its approvals have
	// offerings, so the summary must not pick a single arbitrary phase.
	bookedDay := saturday.AddDays(-1)
	phase := testpkg.CreateTestEnrollmentPhaseAround(t, db, day.AddDays(1))
	offering := testpkg.CreateTestCareOffering(t, db, phase.ID, "Ganztag")
	assignBookedCare(t, db, phase.ID, offering.ID, firstID)
	testpkg.CreateTestPickupSchedule(t, db, firstID, 5, staff.ID, "15:00")
	testpkg.CreateTestPickupException(t, db, firstID, bookedDay, staff.ID, "14:00", "Abholzeit geändert")

	otherPlan := testpkg.CreateTestStudent(t, db, "Other", "Plan", classes[0])
	assignBookedCare(t, db, phase.ID, offering.ID, otherPlan.ID)
	testpkg.CreateTestArrivalSchedule(t, db, otherPlan.ID, 1, staff.ID, "12:00")

	noPlace := testpkg.CreateTestStudent(t, db, "No", "Place", classes[0])
	testpkg.MarkTestStudentWithoutCarePlace(t, db, noPlace.ID)
	// No-care class membership starts on its enrollment day (or creation
	// day if unset). Make this fixture a member on the historical Friday.
	_, err := db.ExecContext(testpkg.Ctx(t), "UPDATE users.student_school_memberships SET enrolled_from = ? WHERE tenant_id = ? AND student_profile_id = ?", bookedDay, testpkg.Tenant(t), noPlace.ID)
	require.NoError(t, err)
	testpkg.CreateTestStudentStatusDay(t, db, noPlace.ID, bookedDay, "excused")

	_, booked := overview(bookedDay, false)
	bookedSheet := assignedClassesData[classday.DayReport](t, get("/?class="+url.QueryEscape(classes[0])+"&date="+bookedDay.String(), false, classDayReadPermission))
	assert.Equal(t, classday.DayTotals{Students: 4, Staying: 1, Leaving: 1, Absent: 1, ListEntries: 1}, booked.Classes[0].Totals)
	assert.Equal(t, bookedSheet.Totals, booked.Classes[0].Totals)
	assert.Equal(t, 2, booked.Classes[0].Changes, "the pickup-only deviation plus the status of the child without a place")
	assert.Equal(t, sheetChanges(bookedSheet), booked.Classes[0].Changes)

	_, err = db.ExecContext(testpkg.Ctx(t), "DELETE FROM education.class_teachers WHERE id = ?", assignments[0])
	require.NoError(t, err)
	_, revoked := overview(day, false)
	require.Len(t, revoked.Classes, 5)
	assert.Equal(t, classes[1], revoked.Classes[0].SchoolClass)
	assert.Equal(t, http.StatusForbidden, get("/?class="+url.QueryEscape(classes[0])+"&date="+day.String(), false, classDayReadPermission).Code)
}

func assignBookedCare(t *testing.T, db *testpkg.DB, phaseID, offeringID, studentID int64) {
	t.Helper()
	token := fmt.Sprintf("assigned-%d-%d", testpkg.Tenant(t), studentID)
	request := testpkg.CreateTestEnrollmentRequestAwaitingGuardian(t, db, phaseID, token+"@example.test", token)
	childID := testpkg.CreateAuditAdjustmentChild(t, db, request.ID)
	ctx := testpkg.Ctx(t)
	_, err := db.ExecContext(ctx, "UPDATE enrollment.request_children SET created_student_id = ? WHERE id = ?", studentID, childID)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO enrollment.care_offering_bookings
		(tenant_id, request_child_id, care_offering_id) VALUES (?, ?, ?)`, request.TenantID, childID, offeringID)
	require.NoError(t, err)
}

func assignedClassesData[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var payload struct {
		Data T `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	return payload.Data
}

func sheetChanges(report classday.DayReport) int {
	var count int
	for _, row := range report.Rows {
		if !row.ListEntry && (row.Status != "" || row.PickupChanged) {
			count++
		}
	}
	return count
}
