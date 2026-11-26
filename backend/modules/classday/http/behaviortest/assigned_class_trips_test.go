package classdayhttp_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/classday"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// tripLines renders the trips of the report as "class children@return",
// "-" for a trip over the whole day.
func tripLines(report classday.AssignedClassesReport) []string {
	lines := []string{}
	for _, class := range report.Classes {
		for _, trip := range class.Trips {
			at := "-"
			if trip.ReturnTime != nil {
				at = *trip.ReturnTime
			}
			lines = append(lines, fmt.Sprintf("%s %d@%s", class.SchoolClass, trip.Children, at))
		}
	}
	return lines
}

// TestAssignedClassesShowTheClassTrips is Seam 1 of the Klassenausflug in
// "Heute anders" of moto schule (#8155): the trips are reported through
// the class-trip route of moto schule and read through the class summaries
// the start page loads. A Lehrkraft sees the trips of her own classes, per
// return time and without a child or a reason; another Lehrkraft's class,
// another day and another school stay out.
func TestAssignedClassesShowTheClassTrips(t *testing.T) {
	t.Parallel()
	f := setupClassTripFixture(t)
	f.openTrips(t)
	monday, err := calendar.ParseDate(classTripMonday)
	require.NoError(t, err)
	testpkg.CreateTestEnrollmentPhaseAround(t, f.db, monday)
	third := testpkg.CreateTestStudent(t, f.db, "Cleo", "Ausflug", f.class)

	// A day outing of two children with a return time, a Klassenfahrt of
	// the third, both with a reason the Lehrkraft entered.
	code, body := f.post(t, fmt.Sprintf(`{"from":%q,"to":%q,"student_ids":["%d","%d"],"reason":"Zoo","return_time":"13:30"}`,
		classTripMonday, classTripMonday, f.first, f.second), classTripWritePermission)
	require.Equal(t, http.StatusCreated, code, body)
	code, body = f.post(t, fmt.Sprintf(`{"from":%q,"to":%q,"student_ids":["%d"],"reason":"Landheim"}`,
		classTripMonday, classTripMonday, third.ID), classTripWritePermission)
	require.Equal(t, http.StatusCreated, code, body)

	// Another Lehrkraft's class goes on a Klassenfahrt the same day.
	other, otherAccount := testpkg.CreateTestStaffWithAccount(t, f.db, "Olaf", fmt.Sprintf("Andere-%d", time.Now().UnixNano()))
	otherClass := fmt.Sprintf("ot%d", time.Now().UnixNano()%100000)
	testpkg.CreateTestClassTeacher(t, f.db, other.ID, otherClass)
	otherChild := testpkg.CreateTestStudent(t, f.db, "Dora", "Fremdklasse", otherClass)
	otherClaims := sessiontoken.AppClaims{ID: int(otherAccount.ID), Sub: otherAccount.Email, Roles: []string{"lehrkraft"}, TenantID: testpkg.Tenant(t), Scope: tenant.ScopeSchool}
	req := httptest.NewRequest(http.MethodPost, "/class-trips/"+otherClass, strings.NewReader(fmt.Sprintf(`{"from":%q,"to":%q,"student_ids":["%d"]}`, classTripMonday, classTripMonday, otherChild.ID)))
	req.Header.Set("Content-Type", "application/json")
	rec := testutil.ExecuteWithAuthPermissions(t, f.router, req, otherClaims, []string{classTripWritePermission})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	// Another school has a class of the same name on a trip.
	foreignID, _ := testpkg.CreateTestTenant(t, f.db)
	foreignChild := testpkg.CreateTestStudentForTenant(t, f.db, foreignID, "Emil", "Fremdschule", f.class)
	testpkg.CreateTestStudentStatusDayForTenant(t, f.db, foreignID, foreignChild.ID, monday, "class_trip")

	read := func(t *testing.T, claims sessiontoken.AppClaims, date string, perms ...string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/assigned-classes?date="+date, nil)
		return testutil.ExecuteWithAuthPermissions(t, f.router, req, claims, perms)
	}

	t.Run("the Lehrkraft sees the trips of her class, no child and no reason", func(t *testing.T) {
		rec := read(t, f.claims, classTripMonday, classDayReadPermission)
		report := assignedClassesData[classday.AssignedClassesReport](t, rec)
		assert.Equal(t, []string{f.class + " 1@-", f.class + " 2@13:30"}, tripLines(report))
		for _, leak := range []string{"Zoo", "Landheim", "Ausflug", "Anna", "Cleo", otherClass, "Fremdschule"} {
			assert.NotContains(t, rec.Body.String(), leak)
		}
	})

	t.Run("the other Lehrkraft sees her own class only", func(t *testing.T) {
		report := assignedClassesData[classday.AssignedClassesReport](t, read(t, otherClaims, classTripMonday, classDayReadPermission))
		assert.Equal(t, []string{otherClass + " 1@-"}, tripLines(report))
	})

	t.Run("the next day has no trip", func(t *testing.T) {
		next := monday.AddDays(1).String()
		report := assignedClassesData[classday.AssignedClassesReport](t, read(t, f.claims, next, classDayReadPermission))
		assert.Empty(t, tripLines(report))
		require.NotEmpty(t, report.Classes)
		assert.NotNil(t, report.Classes[0].Trips, "the wire keeps an empty list")
	})

	t.Run("without class_day:read the route refuses", func(t *testing.T) {
		rec := read(t, f.claims, classTripMonday, classTripWritePermission)
		assert.Equal(t, http.StatusForbidden, rec.Code)
		assert.NotContains(t, rec.Body.String(), "13:30")
	})
}
