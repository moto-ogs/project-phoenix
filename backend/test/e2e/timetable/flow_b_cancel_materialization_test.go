package e2e_timetable

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestFlowB_CancelSkipsMaterialization covers the admin "aktivitaet faellt
// aus" workflow: materialize creates an instance and its expected students,
// and a `cancelled` exception for that date makes the next materialization
// skip the candidate while the existing instance stays.
func TestFlowB_CancelSkipsMaterialization(t *testing.T) {
	t.Parallel()
	testpkg.SetupIsolatedTestDB(t)
	s := setupTimetableScenarioModule(t)

	// --- Setup: target Monday at 13:00–14:00 -------------------------------
	target := s.plannableWeekday(1, 7) // Mon, >=7 days out
	fromS := target.String()

	s.createActivePeriod(fmt.Sprintf("E2E-Flow-B-%d", time.Now().UnixNano()), target)

	room := testpkg.CreateTestRoom(t, s.db, "FlowB-Room")

	staff1 := testpkg.CreateTestStaff(t, s.db, "FlowB", "Staff1")
	staff2 := testpkg.CreateTestStaff(t, s.db, "FlowB", "Staff2")
	alice := testpkg.CreateTestStudent(t, s.db, "Alice", "FlowB", "3a")
	bob := testpkg.CreateTestStudent(t, s.db, "Bob", "FlowB", "3a")
	cleo := testpkg.CreateTestStudent(t, s.db, "Cleo", "FlowB", "3a")

	tmpl := s.buildTemplate(templateSpec{
		name:       "Lesen-AG",
		weekday:    1, // Monday
		startHHMM:  "13:00",
		endHHMM:    "14:00",
		roomID:     room.ID,
		staffIDs:   []int64{staff1.ID, staff2.ID},
		studentIDs: []int64{alice.ID, bob.ID, cleo.ID},
	})

	// Arrival schedules for Monday: alice + bob arrive 12:50. Cleo has an
	// arrival exception saying she won't come at all (absence).
	testpkg.CreateTestArrivalSchedule(t, s.db, alice.ID, 1, staff1.ID, "12:50")
	testpkg.CreateTestArrivalSchedule(t, s.db, bob.ID, 1, staff1.ID, "12:50")
	testpkg.CreateTestArrivalException(t, s.db, cleo.ID, target, staff1.ID, "", "krank")

	// --- Step 1: materialize -----------------------------------------------
	matReq := map[string]any{"from_date": fromS, "to_date": fromS}
	rr := s.do("POST", "/materialize", matReq, s.primaryAdminClaims())
	require.Equal(t, http.StatusOK, rr.Code, "materialize body=%s", rr.Body.String())

	var matResp struct {
		InstancesCreated        int `json:"instances_created"`
		InstanceStudentsCreated int `json:"instance_students_created"`
	}
	decodeResponse(t, rr, &matResp)
	require.Equal(t, 1, matResp.InstancesCreated)
	require.Equal(t, 3, matResp.InstanceStudentsCreated)

	instance := fetchOneInstance(t, s, tmpl.group.ID, target)

	// --- Step 2: insert cancelled exception --------------------------------
	cancelledExc := &testpkg.ActivityException{
		ActivityGroupID: tmpl.group.ID,
		ExceptionDate:   testpkg.ScheduleDate(target),
		ExceptionType:   testpkg.ScheduleExceptionCancelled,
		Reason:          testpkg.StrPtr("Heizung kaputt"),
	}
	cancelledExc.TenantID = s.primaryTenant
	_, err := s.db.NewInsert().
		Model(cancelledExc).
		ModelTableExpr(`schedule.activity_exceptions`).
		Exec(s.tenantCtx())
	require.NoError(t, err, "insert cancelled exception")

	// --- Step 3: re-materialize — skipped_exception, no new instance -------
	rr = s.do("POST", "/materialize", matReq, s.primaryAdminClaims())
	require.Equal(t, http.StatusOK, rr.Code, "rematerialize body=%s", rr.Body.String())

	var matResp2 struct {
		InstancesCreated           int `json:"instances_created"`
		CandidatesSkippedExisting  int `json:"candidates_skipped_existing"`
		CandidatesSkippedException int `json:"candidates_skipped_exception"`
	}
	decodeResponse(t, rr, &matResp2)
	assert.Equal(t, 0, matResp2.InstancesCreated, "no new instance created")
	// Empirical behaviour (WP-B8): the materialization service checks
	// exceptions BEFORE existing-row dedupe, so a cancelled exception
	// short-circuits the candidate and counts as skipped_exception even
	// when a planned instance already exists for that date. The existing
	// instance itself stays in place.
	assert.Equal(t, 1, matResp2.CandidatesSkippedException,
		"cancelled exception skips the candidate even with an existing planned instance")
	assert.Equal(t, 0, matResp2.CandidatesSkippedExisting)
	assert.Equal(t, instance.ID, fetchOneInstance(t, s, tmpl.group.ID, target).ID, "the existing instance stays in place")
}
