package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// checkTimetableStaffRoutes drives the staff portal's timetable routes the
// catalog proxy forwards (#2352) and no module test answers through the
// assembled production router: calendar period removal, the planning track
// administration, the offering sources, the guardian notice preview and the
// homework feedback of a Lernzeit block.
func checkTimetableStaffRoutes(t *testing.T, api *goldenRuntime) {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	// Attendance and homework feedback need the caller's staff record.
	staff, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, "Plan", fmt.Sprintf("Kraft-%d", time.Now().UnixNano()))
	token := testpkg.MintLiveSessionJWT(t, db, testutil.AdminTestClaimsForTenant(int(account.ID), tenantID))
	request := func(t *testing.T, method, path, body string, data any) {
		t.Helper()
		response := checkpointRequest(api, checkpointScenario{Method: method, Path: path, Authenticated: true, Body: body}, token)
		require.Truef(t, response.Code >= 200 && response.Code < 300, "%s %s: %d %s", method, path, response.Code, response.Body.String())
		if data != nil {
			var envelope struct {
				Data json.RawMessage `json:"data"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope), response.Body.String())
			require.NoError(t, json.Unmarshal(envelope.Data, data), response.Body.String())
		}
	}

	t.Run("calendar period removal", func(t *testing.T) {
		var period struct {
			ID wireID `json:"id"`
		}
		request(t, http.MethodPost, "/api/timetable/periods/",
			fmt.Sprintf(`{"name":"Entfernen-%d","period_type":"custom","start_date":"2041-08-01","end_date":"2041-08-31","is_active":false}`, time.Now().UnixNano()), &period)
		require.Positive(t, period.ID)
		request(t, http.MethodDelete, fmt.Sprintf("/api/timetable/periods/%d", period.ID), "", nil)
		response := checkpointRequest(api, checkpointScenario{Method: http.MethodGet, Path: fmt.Sprintf("/api/timetable/periods/%d", period.ID), Authenticated: true}, token)
		assert.Equal(t, http.StatusNotFound, response.Code, "the removed period is gone")
	})

	t.Run("planning track administration", func(t *testing.T) {
		type track struct {
			ID         wireID  `json:"id"`
			Name       string  `json:"name"`
			SortOrder  int     `json:"sort_order"`
			ArchivedAt *string `json:"archived_at"`
		}
		var early, late track
		request(t, http.MethodPost, "/api/timetable/planning-tracks/", `{"name":"Früh","color":"#5080D8","sort_order":0}`, &early)
		request(t, http.MethodPost, "/api/timetable/planning-tracks/", `{"name":"Spät","color":"#F78C10","sort_order":1}`, &late)
		require.Equal(t, "Früh", early.Name)

		var renamed track
		request(t, http.MethodPut, fmt.Sprintf("/api/timetable/planning-tracks/%d", early.ID), `{"name":"Frühdienst","color":"#5080D8","sort_order":0}`, &renamed)
		assert.Equal(t, "Frühdienst", renamed.Name)

		var ordered []track
		request(t, http.MethodPut, "/api/timetable/planning-tracks/order", fmt.Sprintf(`{"ids":[%d,%d]}`, late.ID, early.ID), &ordered)
		require.Len(t, ordered, 2)
		assert.Equal(t, late.ID, ordered[0].ID, "the stored order leads with the moved track")

		var archived, restored track
		request(t, http.MethodDelete, fmt.Sprintf("/api/timetable/planning-tracks/%d", late.ID), "", &archived)
		assert.NotNil(t, archived.ArchivedAt)
		request(t, http.MethodPost, fmt.Sprintf("/api/timetable/planning-tracks/%d/restore", late.ID), "", &restored)
		assert.Nil(t, restored.ArchivedAt)
	})

	t.Run("offering sources", func(t *testing.T) {
		phase := testpkg.CreateTestEnrollmentPhase(t, db)
		offering := testpkg.CreateTestCareOffering(t, db, phase.ID, "Randstunde")
		var sources struct {
			Offerings []struct {
				ID         wireID `json:"id"`
				PhaseID    wireID `json:"phase_id"`
				TotalCount int    `json:"total_count"`
			} `json:"offerings"`
		}
		request(t, http.MethodGet, "/api/timetable/offering-sources", "", &sources)
		var listed bool
		for _, option := range sources.Offerings {
			if int64(option.ID) == offering.ID {
				listed = true
				assert.Equal(t, phase.ID, option.PhaseID)
			}
		}
		assert.True(t, listed, "the active care offering is a selectable source")

		var counts struct {
			TotalCount int   `json:"total_count"`
			Students   []any `json:"students"`
		}
		request(t, http.MethodGet, fmt.Sprintf("/api/timetable/offering-sources/combined-counts?ids=%d", offering.ID), "", &counts)
		assert.Zero(t, counts.TotalCount, "nobody books the new offering")
		assert.Empty(t, counts.Students)
	})

	day := testpkg.TodayDate()
	room := testpkg.CreateTestRoom(t, db, fmt.Sprintf("Lernzeit-%d", time.Now().UnixNano()))
	block := testpkg.CreateTestActivityInstance(t, db, day, room.ID, testpkg.ActivityInstanceOpts{
		Title: "Lernzeit", StartHHMM: "00:00", EndHHMM: "23:59",
	})
	class := fmt.Sprintf("4l%d", time.Now().UnixNano()%100000)
	child := testpkg.CreateTestStudent(t, db, "Lina", "Lernzeit", class)
	testpkg.CreateTestInstanceStudent(t, db, block.ID, child.ID, testpkg.ScheduleAttendanceStatusExpected)
	testpkg.CreateTestInstanceStaff(t, db, block.ID, staff.ID, testpkg.InstanceStaffOpts{IsPrimary: true})

	t.Run("guardian notice preview", func(t *testing.T) {
		var reach struct {
			ChildCount  int `json:"child_count"`
			FamilyCount int `json:"family_count"`
		}
		request(t, http.MethodGet, fmt.Sprintf("/api/timetable/instances/%d/guardian-notice", block.ID), "", &reach)
		assert.Equal(t, 1, reach.ChildCount)
		assert.Zero(t, reach.FamilyCount, "the child has no guardian with portal access")
	})

	t.Run("homework feedback", func(t *testing.T) {
		_, err := db.ExecContext(testpkg.Ctx(t), `UPDATE schedule.activity_instances SET list_kind = 'learning_time' WHERE id = ?`, block.ID)
		require.NoError(t, err)
		_, err = db.ExecContext(testpkg.Ctx(t), `INSERT INTO education.class_homework (tenant_id, school_class, date, subject, description)
			VALUES (?, ?, ?, 'Mathe', 'Seite 12')`, tenantID, strings.ToUpper(class), day)
		require.NoError(t, err)

		var saved struct {
			StudentID wireID `json:"student_id"`
			Status    string `json:"status"`
		}
		request(t, http.MethodPut, fmt.Sprintf("/api/timetable/operations/instances/%d/students/%d/homework-feedback", block.ID, child.ID), `{"status":"done"}`, &saved)
		assert.Equal(t, child.ID, saved.StudentID)
		assert.Equal(t, "done", saved.Status)
		var stored string
		require.NoError(t, db.NewRaw(`SELECT status FROM education.homework_feedback WHERE tenant_id = ? AND student_id = ?`, tenantID, child.ID).Scan(testpkg.Ctx(t), &stored))
		assert.Equal(t, "done", stored)
	})
}
