package presenceprojectionhttp_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// On a day with changed opening hours the care day ends at the changed
// closing time (#8157): an expected child without check-in and pickup time
// reads "Schule" only until then. The change of one school never moves the
// day of another.
func TestListStudents_ChangedClosingTimeEndsTheCareDay(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	// Friday 12:00 Berlin.
	fixedNow := time.Date(2026, time.August, 21, 10, 0, 0, 0, time.UTC)
	tc.resource.Now = func() time.Time { return fixedNow }
	today := calendar.DateFromTime(fixedNow)

	expectedChild := func(t *testing.T, schoolClass string) int64 {
		t.Helper()
		child := testpkg.CreateTestStudent(t, tc.db, "Expected", "Student", schoolClass)
		staff := testpkg.CreateTestStaff(t, tc.db, "Opening", "Supervisor")
		testpkg.CreateTestArrivalSchedule(t, tc.db, child.ID, 5, staff.ID, "08:00") // Friday
		return child.ID
	}
	location := func(t *testing.T, schoolClass string, childID int64) string {
		t.Helper()
		req := testutil.NewRequest("GET", fmt.Sprintf("/?school_class=%s&page_size=50", schoolClass), nil)
		rr := authExec(t, tc, req, testutil.AdminTestClaims(1), []string{"admin:*"})
		require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())
		return decodeStudentsByID(t, rr.Body.Bytes())[childID].Location
	}

	child := expectedChild(t, "Opening-8157")
	require.Equal(t, "Schule", location(t, "Opening-8157", child), "the regular session end lies ahead")

	changes := schoolCalendarCompose.NewOpeningChanges()
	require.NoError(t, testpkg.WithinTenantContext(t, testpkg.Ctx(t), tc.db, testpkg.Tenant(t), func(txCtx context.Context) error {
		_, err := changes.CreateOpeningChange(txCtx, schoolcalendar.OpeningChangeInput{
			StartDate: today, EndDate: today, OpensAt: "07:30", ClosesAt: "11:30", Reason: "Zeugnisausgabe",
		})
		return err
	}))
	assert.Equal(t, "Abwesend", location(t, "Opening-8157", child), "the school closed at 11:30 today")
	count, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), tc.db, tc.resource.CountAtSchoolToday, []int64{child})
	require.NoError(t, err)
	assert.Zero(t, count, "the dashboard counts through the same care day end")

	t.Run("andere Schule", func(t *testing.T) {
		testpkg.OwnTenant(t)
		other := expectedChild(t, "Opening-8157-B")
		assert.Equal(t, "Schule", location(t, "Opening-8157-B", other), "the change of one school leaves another open")
	})
}
