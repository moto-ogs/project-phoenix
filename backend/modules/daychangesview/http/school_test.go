package daychangesviewhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

func newSchoolRouter(t *testing.T, db *testpkg.DB, today calendar.Date) chi.Router {
	t.Helper()
	resource, err := api.NewSchoolDayChangesTestResource(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), today)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(api.RequestIdentityCacheMiddleware)
	router.Mount("/school/day-changes", resource.SchoolRouter(api.ProtectedSchoolRoutes))
	return router
}

func getSchool(t *testing.T, router chi.Router, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/school/day-changes/today", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	return testutil.ExecuteRequestForTest(t, router, req)
}

func readSchool(t *testing.T, router chi.Router, accountID, tenantID int64, perms ...string) (wireOverview, string) {
	t.Helper()
	rec := getSchool(t, router, testutil.MintTestJWT(t, testpkg.SchoolTestClaims(int(accountID), tenantID, perms...)))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var envelope struct {
		Data wireOverview `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	return envelope.Data, rec.Body.String()
}

// TestSchoolDayChanges is Seam 1 of moto schule (#7670): a changed
// Unterrichtsschluss of the own class, of another class and of another day,
// a closing day, a Schulverwaltung reaching every class, an account without
// the school calendar, one without class_day:read, a staff-portal session
// and a second school, read through the route.
func TestSchoolDayChanges(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.OwnTraegerClosingDays(t, db, tenantID)
	arrivals, err := api.NewDayChangesClassDismissalForTests(testpkg.NewDatabase(t, db))
	require.NoError(t, err)

	teacher, teacherAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lena", "Lehrkraft")
	testpkg.CreateTestClassTeacher(t, db, teacher.ID, "3a")
	other, _ := testpkg.CreateTestStaffWithAccount(t, db, "Olaf", "Andere")
	testpkg.CreateTestClassTeacher(t, db, other.ID, "2c")
	_, officeAccount := testpkg.CreateTestStaffWithAccount(t, db, "Silke", "Sekretariat")
	addClassDismissal(t, arrivals, "3a", day, "11:30", "Lehrerkonferenz")
	addClassDismissal(t, arrivals, "2c", day, "12:15", "Wandertag")
	addClassDismissal(t, arrivals, "3a", day.AddDays(1), "10:00", "Morgen")
	testpkg.CreateTestClosingDay(t, db, day, day, "Pädagogischer Tag")

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign, err := api.NewDayChangesClassDismissalForTests(testpkg.NewDatabase(t, db))
		require.NoError(t, err)
		addClassDismissal(t, foreign, "3a", day, "09:05", "Fremd")
		testpkg.CreateTestClosingDay(t, db, day, day, "Fremde Schule zu")
	})

	router := newSchoolRouter(t, db, day)

	t.Run("a Lehrkraft sees her class and the closing day, no reason", func(t *testing.T) {
		overview, body := readSchool(t, router, teacherAccount.ID, tenantID, "class_day:read", "calendar:school")
		assert.Equal(t, []string{"you class_dismissal_changed 3a 11:30"}, classLines(t, body))
		assert.Equal(t, []string{"school Pädagogischer Tag ->school_calendar"}, closingLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "closing_days"))
		assert.Equal(t, "loaded", sourceStatus(overview, "classes"))
		// The Räume source joined in #8161.
		assert.Len(t, overview.Sources, 5, "moto schule reads only its own sources")
		assert.Contains(t, body, `"target":"school_class"`)
		for _, leak := range []string{"Lehrerkonferenz", "Wandertag", "2c", "12:15", "10:00", "09:05", "Fremd"} {
			assert.NotContains(t, body, leak, "no reason, other class, other day or other school")
		}
	})

	t.Run("the next day shows that day's Unterrichtsschluss only", func(t *testing.T) {
		_, body := readSchool(t, newSchoolRouter(t, db, day.AddDays(1)), teacherAccount.ID, tenantID, "class_day:read", "calendar:school")
		assert.Equal(t, []string{"you class_dismissal_changed 3a 10:00"}, classLines(t, body))
		assert.Empty(t, closingLines(t, body))
	})

	t.Run("the Schulverwaltung sees every class under Schule", func(t *testing.T) {
		_, body := readSchool(t, router, officeAccount.ID, tenantID, "class_day:read", "class_day:all_classes")
		assert.Equal(t, []string{
			"school class_dismissal_changed 2c 12:15",
			"school class_dismissal_changed 3a 11:30",
		}, classLines(t, body))
	})

	t.Run("without the school calendar no closing day and no failure", func(t *testing.T) {
		overview, body := readSchool(t, router, teacherAccount.ID, tenantID, "class_day:read")
		assert.Empty(t, closingLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "closing_days"))
	})

	t.Run("an account without a class of its own sees no class", func(t *testing.T) {
		_, body := readSchool(t, router, officeAccount.ID, tenantID, "class_day:read")
		assert.Empty(t, classLines(t, body))
	})

	t.Run("without class_day:read the route refuses", func(t *testing.T) {
		rec := getSchool(t, router, testutil.MintTestJWT(t, testpkg.SchoolTestClaims(int(teacherAccount.ID), tenantID, "calendar:school")))
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	})

	t.Run("a staff-portal session does not reach moto schule", func(t *testing.T) {
		rec := getSchool(t, router, testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(teacherAccount.ID), tenantID, "class_day:read", "calendar:school")))
		assert.NotEqual(t, http.StatusOK, rec.Code)
		assert.NotContains(t, rec.Body.String(), "3a")
	})
}

// TestSchoolDayChangesQueryBudget measures the route for a Lehrkraft with
// one and with four classes that end at another time today, a cover on one
// of her Aufsichten and a cancelled date of one of her appointments.
func TestSchoolDayChangesQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tenantID := testpkg.Tenant(t)
	arrivals, err := api.NewDayChangesClassDismissalForTests(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	teacher, account := testpkg.CreateTestStaffWithAccount(t, db, "Budget", "Lehrkraft")
	testpkg.CreateTestClosingDay(t, db, day, day, "Budget zu")
	// A cover on one of her Aufsichten (#8148): read with the classes.
	absent := testpkg.CreateTestStaff(t, db, "Budget", "Abwesend")
	room := testpkg.CreateTestRoom(t, db, "Budgetraum")
	block := testpkg.CreateTestActivityInstance(t, db, day, room.ID, testpkg.ActivityInstanceOpts{Title: "Budgetaufsicht", StartHHMM: "09:30", EndHHMM: "09:50"})
	testpkg.CreateTestInstanceStaff(t, db, block.ID, absent.ID, testpkg.InstanceStaffOpts{IsPrimary: true, IsAbsent: true})
	testpkg.CreateTestInstanceStaff(t, db, block.ID, teacher.ID, testpkg.InstanceStaffOpts{IsSubstitute: true})
	// A cancelled date of one of her appointments (#8155): the statement the
	// caller's staff record with its classes saves (one School Membership read).
	writes, err := api.NewDayChangesTestCalendar(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)
	meeting, err := writes.Create(ctx, api.DayChangesTestAppointment{Organizer: teacher.ID, Title: "Budgettermin", Location: "Büro", Day: day.AddDays(-7), StartHour: 8, EndHour: 9, Weekly: true})
	require.NoError(t, err)
	require.NoError(t, writes.Except(ctx, meeting, day, api.DayChangesTestException{Cancel: true}))
	router := newSchoolRouter(t, db, day)
	counter := testpkg.CaptureQueries(t, db)
	var statements testpkg.QueryMeasurement
	baseline := 0
	for round, n := range []int{1, 4} {
		for created := baseline; created < n; created++ {
			class := fmt.Sprintf("b%d", created)
			testpkg.CreateTestClassTeacher(t, db, teacher.ID, class)
			addClassDismissal(t, arrivals, class, day, "11:00", "Budget")
		}
		baseline = n
		counter.Reset()
		_, body := readSchool(t, router, account.ID, tenantID, "class_day:read", "calendar:school", "supervision:own")
		require.Len(t, classLines(t, body), n)
		require.Len(t, activityLines(t, body), 1, "the cover on her Aufsicht")
		require.Len(t, appointmentLines(t, body), 1, "the cancelled date of her appointment")
		measured := counter.Measurement(counter.Queries())
		if round > 0 {
			require.Len(t, measured.Statements, len(statements.Statements), "statements must not grow with the classes")
		}
		statements = measured
	}
	querybudgets.AssertQueryBudget(t, "school.day_changes.today", statements)
}
