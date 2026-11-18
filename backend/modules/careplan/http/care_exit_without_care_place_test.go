package careplanhttp_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCareExitLeavesOutChildrenWithoutCarePlace keeps a child without an OGS
// place (#4803 review) out of the OGS care exit: the preview names why it
// cannot be ended, and the archive of ended care never lists it. The clock
// is fixed on studentsTestToday: the last care day 2027-06-30 lies ahead of
// it and the ended care of 2026-01-30 behind it on every day the test runs.
func TestCareExitLeavesOutChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRouteWithCareLifecycle(t, false, fixedCalendarClock)
	actor := testpkg.CreateTestAccount(t, tc.db, "care-exit-without-place@example.com")
	claims := testutil.AdminTestClaims(int(actor.ID))

	child := testpkg.CreateTestStudent(t, tc.db, "Ohne", "Platzkind", "1a")
	testpkg.MarkTestStudentWithoutCarePlace(t, tc.db, child.ID)
	preview := authExec(t, tc, testutil.NewAuthenticatedRequest(t, http.MethodPost, "/care-end/preview", map[string]any{
		"student_ids":   []string{fmt.Sprintf("%d", child.ID)},
		"last_care_day": "2027-06-30",
		"reason":        careplan.CareExitReasonMovedAway,
	}), claims, []string{"users:delete"})
	require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
	assert.Contains(t, preview.Body.String(), careplan.CareBlockerWithoutCarePlace)

	left := testpkg.CreateTestStudent(t, tc.db, "Weg", "Ohneplatz", "1a")
	ended := calendar.Date("2026-01-30")
	testpkg.SetStudentLifecycle(t, tc.db, left.ID, "active", nil, &ended)
	testpkg.MarkTestStudentWithoutCarePlace(t, tc.db, left.ID)
	archive := authExec(t, tc, testutil.NewAuthenticatedRequest(t, http.MethodGet, "/ended-care", nil), claims, []string{"users:delete"})
	require.Equal(t, http.StatusOK, archive.Code, archive.Body.String())
	assert.NotContains(t, archive.Body.String(), "Ohneplatz")
}
