package daychangesviewhttp_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// getOn reads path with ?date=date under token.
func getOn(t *testing.T, router chi.Router, path, date, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path+"?date="+date, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	return testutil.ExecuteRequestForTest(t, router, req)
}

// decodeOverview decodes the overview of a success answer.
func decodeOverview(t *testing.T, rec *httptest.ResponseRecorder) (wireOverview, string) {
	t.Helper()
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var envelope struct {
		Data wireOverview `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	return envelope.Data, rec.Body.String()
}

// readOn reads the staff overview of date.
func readOn(t *testing.T, router chi.Router, date string, accountID, tenantID int64, perms ...string) (wireOverview, string) {
	t.Helper()
	token := testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(accountID), tenantID, perms...))
	return decodeOverview(t, getOn(t, router, "/api/day-changes/today", date, token))
}

// staffLines are the summary lines of the Personal entries.
func staffLines(entries []wireEntry) []string {
	lines := []string{}
	for _, line := range summary(entries) {
		kind := strings.Fields(line)[1]
		if strings.HasPrefix(kind, "staff_") || strings.HasPrefix(kind, "group_substitution") {
			lines = append(lines, line)
		}
	}
	return lines
}

// TestDayChangesTomorrow is Seam 1 of the preview on tomorrow (#7657): the
// school's today is the day before the fixtures' day, and the overview reads
// the fixtures' day as tomorrow. Every source answers for tomorrow with the
// same rule as for today (absence, pickup time, closing day, class trip,
// cancelled lunch); another school, today's and the day after tomorrow's
// changes stay out, and any day but today and tomorrow is refused.
func TestDayChangesTomorrow(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	today, tomorrow := day.AddDays(-1), day

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	igel := testpkg.CreateTestEducationGroup(t, db, "Igel")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, carer.ID)
	colleague := testpkg.CreateTestTeacher(t, db, "Ben", "Kollege")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, colleague.ID)
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, colleague.StaffID, tomorrow, tomorrow, "Grippe Ben")
	other := testpkg.CreateTestStaff(t, db, "Clara", "Andere")
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, other.ID, tomorrow, tomorrow, "Grippe Clara")
	todayOnly := testpkg.CreateTestStaff(t, db, "Emil", "Heute")
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, todayOnly.ID, today, today, "Grippe Emil")
	later := testpkg.CreateTestStaff(t, db, "Uwe", "Uebermorgen")
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, later.ID, tomorrow.AddDays(1), tomorrow.AddDays(1), "")
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")

	leo := testpkg.CreateTestStudent(t, db, "Leo", "Kind", "2a")
	testpkg.AssignStudentToGroup(t, db, leo.ID, igel.ID)
	testpkg.CreateTestPickupException(t, db, leo.ID, tomorrow, carer.StaffID, "14:30", "Arzttermin Leo")
	mia := testpkg.CreateTestStudent(t, db, "Mia", "Kind", "2a")
	testpkg.AssignStudentToGroup(t, db, mia.ID, igel.ID)
	testpkg.CreateTestStudentStatusDay(t, db, mia.ID, today, "sick")
	trip := testpkg.CreateTestStudent(t, db, "Reise", "Kind", "3a")
	testpkg.AssignStudentToGroup(t, db, trip.ID, igel.ID)
	testpkg.CreateTestStudentStatusDay(t, db, trip.ID, tomorrow, "class_trip")

	rig, err := api.NewDayChangesMealPlanTestRig(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), today)
	require.NoError(t, err)
	require.NoError(t, rig.Enable(testpkg.Ctx(t)))
	cancel := httptest.NewRequest(http.MethodPut, "/api/meal-plan/days/"+tomorrow.String()+"/cancellation", strings.NewReader(`{"reason":"Der Caterer liefert nicht"}`))
	cancel.Header.Set("Content-Type", "application/json")
	cancel.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(leadAccount.ID), tenantID, "meals:manage")))
	response := testutil.ExecuteRequestForTest(t, rig.Router, cancel)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		testpkg.CreateTestClosingDay(t, db, tomorrow, tomorrow, "Fremde Schule zu")
		foreign := testpkg.CreateTestStaff(t, db, "Xaver", "Fremd")
		testpkg.CreateTestStaffAbsenceSpan(t, db, testpkg.Tenant(t), foreign.ID, tomorrow, tomorrow, "")
	})

	router := newRouter(t, db, today)

	t.Run("care staff sees tomorrow with the rule of today", func(t *testing.T) {
		overview, body := readOn(t, router, tomorrow.String(), carerAccount.ID, tenantID, "users:read", "schedules:read")
		assert.Equal(t, tomorrow.String(), overview.Date)
		assert.Equal(t, []string{
			"you staff_absent Ben Kollege/absent ->staff_member",
			"school staff_absent_count n=1 ->staff_list",
		}, staffLines(overview.Entries), "names in the own group, a number for the school")
		assert.Equal(t, []string{"you child_pickup_changed Leo 14:30 @Igel ->student"}, childLines(t, body))
		assert.Equal(t, []string{"you class_trip 3a n=1"}, classLines(t, body))
		assert.Equal(t, []string{"school Der Caterer liefert nicht"}, mealCancellationLines(t, body))
		for _, source := range overview.Sources {
			assert.Equal(t, "loaded", source.Status, source.Source)
		}
		for _, leak := range []string{"Grippe", "Arzttermin", "Clara", "Emil", "Uwe", "Mia", "Xaver", "Fremde"} {
			assert.NotContains(t, body, leak, "no reason, no hidden name, no other day, no other school")
		}
	})

	t.Run("the lead sees every name tomorrow", func(t *testing.T) {
		overview, body := readOn(t, router, tomorrow.String(), leadAccount.ID, tenantID, "users:read", "vacation:approve")
		assert.Equal(t, []string{
			"school staff_absent Ben Kollege/absent ->staff_absences",
			"school staff_absent Clara Andere/absent ->staff_absences",
		}, staffLines(overview.Entries))
		assert.NotContains(t, body, "Xaver")
	})

	t.Run("without the rights tomorrow has the same gaps and no failure", func(t *testing.T) {
		overview, body := readOn(t, router, tomorrow.String(), carerAccount.ID, tenantID)
		assert.Empty(t, childLines(t, body))
		assert.Empty(t, closingLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "children"))
		assert.Equal(t, "loaded", sourceStatus(overview, "closing_days"))
	})

	t.Run("today by date is today", func(t *testing.T) {
		overview, body := readOn(t, router, today.String(), carerAccount.ID, tenantID, "users:read")
		assert.Equal(t, today.String(), overview.Date)
		assert.Equal(t, []string{"you child_absent Mia sick @Igel ->student"}, childLines(t, body))
		assert.NotContains(t, body, "Leo")
	})

	// Last: a closing day refuses the cancelled lunch of the same day.
	t.Run("a closing day tomorrow stands as its entry", func(t *testing.T) {
		testpkg.CreateTestClosingDay(t, db, tomorrow, tomorrow, "Brückentag")
		_, body := readOn(t, router, tomorrow.String(), carerAccount.ID, tenantID, "schedules:read")
		assert.Equal(t, []string{"school Brückentag"}, closingLines(t, body))
		_, body = readOn(t, router, today.String(), carerAccount.ID, tenantID, "schedules:read")
		assert.Empty(t, closingLines(t, body), "tomorrow's closing day is not today's")
	})

	t.Run("any other day is refused", func(t *testing.T) {
		token := testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(leadAccount.ID), tenantID, "users:read", "vacation:approve"))
		for _, date := range []string{today.AddDays(-1).String(), tomorrow.AddDays(1).String(), "morgen", "2026-13-01"} {
			rec := getOn(t, router, "/api/day-changes/today", date, token)
			assert.Equal(t, http.StatusBadRequest, rec.Code, date+": "+rec.Body.String())
			assert.Contains(t, rec.Body.String(), `"code":"general.input"`, date)
			assert.NotContains(t, rec.Body.String(), "Uwe", date)
		}
	})
}

// TestSchoolDayChangesTomorrow is the preview of moto schule (#7657): the
// Lehrkraft sees tomorrow's Unterrichtsschluss of her class and tomorrow's
// closing day with the rules of today; another class, another school and
// another day stay out.
func TestSchoolDayChangesTomorrow(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.OwnTraegerClosingDays(t, db, tenantID)
	arrivals, err := api.NewDayChangesClassDismissalForTests(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	today, tomorrow := day.AddDays(-1), day

	teacher, teacherAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lena", "Lehrkraft")
	testpkg.CreateTestClassTeacher(t, db, teacher.ID, "3a")
	addClassDismissal(t, arrivals, "3a", today, "12:00", "Heute")
	addClassDismissal(t, arrivals, "3a", tomorrow, "11:30", "Lehrerkonferenz")
	addClassDismissal(t, arrivals, "2c", tomorrow, "12:15", "Wandertag")
	testpkg.CreateTestClosingDay(t, db, tomorrow, tomorrow, "Pädagogischer Tag")

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		testpkg.CreateTestClosingDay(t, db, tomorrow, tomorrow, "Fremde Schule zu")
	})

	router := newSchoolRouter(t, db, today)
	token := testutil.MintTestJWT(t, testpkg.SchoolTestClaims(int(teacherAccount.ID), tenantID, "class_day:read", "calendar:school"))

	t.Run("a Lehrkraft sees tomorrow of her class", func(t *testing.T) {
		overview, body := decodeOverview(t, getOn(t, router, "/school/day-changes/today", tomorrow.String(), token))
		assert.Equal(t, tomorrow.String(), overview.Date)
		assert.Equal(t, []string{"you class_dismissal_changed 3a 11:30"}, classLines(t, body))
		assert.Equal(t, []string{"school Pädagogischer Tag ->school_calendar"}, closingLines(t, body))
		for _, leak := range []string{"Lehrerkonferenz", "2c", "12:00", "Fremde"} {
			assert.NotContains(t, body, leak)
		}
	})

	t.Run("any other day is refused", func(t *testing.T) {
		rec := getOn(t, router, "/school/day-changes/today", tomorrow.AddDays(1).String(), token)
		assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	})
}
