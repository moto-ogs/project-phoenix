package careplanhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// weeklyPlanVersion reads the token of the child's weekly plan the way the
// editor does: from the pickup read (ADR 0311).
func weeklyPlanVersion(t *testing.T, tc *testContext, studentID int64) string {
	t.Helper()
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Plan", fmt.Sprintf("Reader%d", studentID))
	req := testutil.NewAuthenticatedRequest(t, "GET", fmt.Sprintf("/%d/pickup-schedules", studentID), nil)
	rr := authExec(t, tc, req, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
	var body struct {
		Data struct {
			WeeklyPlanVersion string `json:"weekly_plan_version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	require.NotEmpty(t, body.Data.WeeklyPlanVersion, "the pickup read must carry the weekly plan token")
	return body.Data.WeeklyPlanVersion
}

// A weekly plan save carries the token of the plan it was made on. A colleague
// who saved in between makes the token stale: the save is refused and writes
// nothing, a save with the current token goes through (ADR 0311).
func TestWeeklyPlanSaveRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Weekly", "PlanTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))
	exec := func(method, path string, body map[string]any) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, method, path, body)
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		return rr.Code, rr.Body.String()
	}
	arrivalRows := func(studentID int64) int64 {
		count, err := tc.db.NewSelect().TableExpr("schedule.student_arrival_schedules").
			Where("student_id = ?", studentID).Count(testpkg.Ctx(t))
		require.NoError(t, err)
		return count
	}
	weekdayNotes := func(studentID int64) map[int]string {
		notes, err := tc.resource.PickupScheduleService.GetStudentPickupNotes(testpkg.Ctx(t), studentID)
		require.NoError(t, err)
		byWeekday := map[int]string{}
		for _, note := range notes {
			if note.Weekday != 0 {
				byWeekday[note.Weekday] = note.Content
			}
		}
		return byWeekday
	}

	t.Run("arrival plan with weekday notes", func(t *testing.T) {
		student := testpkg.CreateTestStudent(t, tc.db, "WeeklyStale", "Test", "WPS1")
		read := weeklyPlanVersion(t, tc, student.ID)
		path := fmt.Sprintf("/%d/arrival-schedules", student.ID)

		code, body := exec("PUT", path, map[string]any{
			"schedules":        []map[string]any{{"weekday": 1, "expected_arrival": "07:45"}},
			"expected_version": read,
		})
		require.Equal(t, http.StatusOK, code, "Body: %s", body)
		stored := arrivalRows(student.ID)

		code, body = exec("PUT", path, map[string]any{
			"schedules":        []map[string]any{{"weekday": 2, "expected_arrival": "08:15"}},
			"weekday_notes":    []map[string]any{{"weekday": 2, "content": "Dienstags bei Oma"}},
			"expected_version": read,
		})
		require.Equal(t, http.StatusConflict, code, "Body: %s", body)
		assert.Contains(t, body, readstate.ChangedCode)
		assert.Equal(t, stored, arrivalRows(student.ID), "a refused save writes no arrival row")
		assert.Empty(t, weekdayNotes(student.ID), "a refused save writes no weekday note")

		code, body = exec("PUT", path, map[string]any{
			"schedules":        []map[string]any{{"weekday": 2, "expected_arrival": "08:15"}},
			"weekday_notes":    []map[string]any{{"weekday": 2, "content": "Dienstags bei Oma"}},
			"expected_version": weeklyPlanVersion(t, tc, student.ID),
		})
		require.Equal(t, http.StatusOK, code, "Body: %s", body)
		assert.Equal(t, map[int]string{2: "Dienstags bei Oma"}, weekdayNotes(student.ID))
		var saved struct {
			Data struct {
				WeeklyPlanVersion string `json:"weekly_plan_version"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &saved))
		assert.Equal(t, weeklyPlanVersion(t, tc, student.ID), saved.Data.WeeklyPlanVersion,
			"the save answers the token of the saved plan")
	})

	t.Run("weekday notes alone", func(t *testing.T) {
		student := testpkg.CreateTestStudent(t, tc.db, "WeeklyNotes", "Test", "WPS2")
		path := fmt.Sprintf("/%d/pickup-notes", student.ID)
		code, body := exec("PUT", path, map[string]any{
			"notes":            []map[string]any{{"weekday": 1, "content": "Montags zu Hause"}},
			"expected_version": "",
		})
		require.Equal(t, http.StatusConflict, code, "an empty token is refused. Body: %s", body)
		assert.Contains(t, body, readstate.ChangedCode)
		assert.Empty(t, weekdayNotes(student.ID))

		read := weeklyPlanVersion(t, tc, student.ID)
		code, body = exec("PUT", fmt.Sprintf("/%d/arrival-schedules", student.ID), map[string]any{
			"schedules": []map[string]any{{"weekday": 3, "expected_arrival": "12:00"}}, "expected_version": read,
		})
		require.Equal(t, http.StatusOK, code, "Body: %s", body)
		code, body = exec("PUT", path, map[string]any{
			"notes":            []map[string]any{{"weekday": 1, "content": "Montags zu Hause"}},
			"expected_version": read,
		})
		require.Equal(t, http.StatusConflict, code, "Body: %s", body)
		assert.Empty(t, weekdayNotes(student.ID), "a refused save writes no weekday note")

		code, body = exec("PUT", path, map[string]any{
			"notes":            []map[string]any{{"weekday": 1, "content": "Montags zu Hause"}},
			"expected_version": weeklyPlanVersion(t, tc, student.ID),
		})
		require.Equal(t, http.StatusOK, code, "Body: %s", body)
		assert.Equal(t, map[int]string{1: "Montags zu Hause"}, weekdayNotes(student.ID))
	})
}

// The pickup path of the weekly editor checks the same token: an apply made on
// a plan a colleague changed since is refused before it writes anything, even
// with a fresh preview, and the current token applies the plan with its
// weekday notes in one unit.
func TestWeeklyPlanApplyRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, fixedCalendarClock)
	student := testpkg.CreateTestStudent(t, tc.db, "WeeklyApply", "Test", "WPA1")
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Weekly", "ApplyTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))
	exec := func(method, path string, body map[string]any) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, method, path, body)
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		return rr.Code, rr.Body.String()
	}
	pickupRows := func() int64 {
		count, err := tc.db.NewSelect().TableExpr("schedule.student_pickup_schedules").
			Where("student_id = ?", student.ID).Count(testpkg.Ctx(t))
		require.NoError(t, err)
		return count
	}

	read := weeklyPlanVersion(t, tc, student.ID)
	code, body := exec("PUT", fmt.Sprintf("/%d/pickup-notes", student.ID), map[string]any{
		"notes": []map[string]any{{"weekday": 1, "content": "Montags bei Oma"}}, "expected_version": read,
	})
	require.Equal(t, http.StatusOK, code, "a colleague saves first. Body: %s", body)

	plan := map[string]any{
		"schedules":         []map[string]any{{"weekday": 1, "pickup_time": "13:45"}},
		"arrival_schedules": []map[string]any{{"weekday": 1, "expected_arrival": "11:30"}},
		"care_days":         []int{1},
		"effective_from":    studentsTestToday.String(),
		"weekday_notes":     []map[string]any{{"weekday": 1, "content": "Montags zu Hause"}},
	}
	apply := func(version string) (int, string) {
		body := cloneMap(plan)
		body["preview_token"] = postPickupAdjustmentPreview(t, tc, student.ID, account.ID, plan).PreviewToken
		body["expected_version"] = version
		return exec("POST", fmt.Sprintf("/%d/pickup-schedules/apply", student.ID), body)
	}

	code, body = apply(read)
	require.Equal(t, http.StatusConflict, code, "Body: %s", body)
	assert.Contains(t, body, readstate.ChangedCode)
	assert.Zero(t, pickupRows(), "a refused apply writes no pickup row")
	notes, err := tc.resource.PickupScheduleService.GetStudentPickupNotes(testpkg.Ctx(t), student.ID)
	require.NoError(t, err)
	require.Len(t, notes, 1)
	assert.Equal(t, "Montags bei Oma", notes[0].Content, "a refused apply keeps the colleague's note")

	code, body = apply(weeklyPlanVersion(t, tc, student.ID))
	require.Equal(t, http.StatusOK, code, "Body: %s", body)
	assert.Positive(t, pickupRows(), "the apply writes the pickup row")
	notes, err = tc.resource.PickupScheduleService.GetStudentPickupNotes(testpkg.Ctx(t), student.ID)
	require.NoError(t, err)
	require.Len(t, notes, 1)
	assert.Equal(t, "Montags zu Hause", notes[0].Content, "the apply writes the weekday notes with the plan")
	var saved struct {
		Data struct {
			WeeklyPlanVersion string `json:"weekly_plan_version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &saved))
	assert.Equal(t, weeklyPlanVersion(t, tc, student.ID), saved.Data.WeeklyPlanVersion)
}

// careNoteVersion reads the token of one arrival or pickup note from the read
// the day editor uses (ADR 0311); query names the day the note is on.
func careNoteVersion(t *testing.T, tc *testContext, studentID, noteID int64, read, query string) string {
	t.Helper()
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Note", fmt.Sprintf("Reader%d", noteID))
	req := testutil.NewAuthenticatedRequest(t, "GET", fmt.Sprintf("/%d/%s?%s", studentID, read, query), nil)
	rr := authExec(t, tc, req, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
	var body struct {
		Data struct {
			Notes []struct {
				ID      testpkg.ID `json:"id"`
				Version string     `json:"version"`
			} `json:"notes"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	for _, note := range body.Data.Notes {
		if int64(note.ID) == noteID {
			require.NotEmpty(t, note.Version)
			return note.Version
		}
	}
	t.Fatalf("note %d is not in the read %s?%s", noteID, read, query)
	return ""
}

func arrivalNoteVersion(t *testing.T, tc *testContext, studentID, noteID int64, date string) string {
	t.Helper()
	return careNoteVersion(t, tc, studentID, noteID, "arrival-schedules", "date="+date)
}

func pickupNoteVersion(t *testing.T, tc *testContext, studentID, noteID int64, date string) string {
	t.Helper()
	return careNoteVersion(t, tc, studentID, noteID, "pickup-schedules", "from="+date+"&to="+date)
}

// A single note is edited from the day the editor read. A colleague's change
// in between makes the read stale: the change is refused and the stored text
// stays; the current version saves (ADR 0311).
func TestCareNoteUpdateRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Note", "StaleTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))
	exec := func(method, path string, body map[string]any) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, method, path, body)
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		return rr.Code, rr.Body.String()
	}
	for _, kind := range []struct{ notes, read string }{{"arrival-notes", "arrival"}, {"pickup-notes", "pickup"}} {
		t.Run(kind.notes, func(t *testing.T) {
			student := testpkg.CreateTestStudent(t, tc.db, "NoteStale", kind.read, "NS1")
			code, body := exec("POST", fmt.Sprintf("/%d/%s", student.ID, kind.notes), map[string]any{
				"note_date": "2026-04-15", "content": "Oma holt ab",
			})
			require.Equal(t, http.StatusCreated, code, "Body: %s", body)
			var created struct {
				Data struct {
					ID      testpkg.ID `json:"id"`
					Version string     `json:"version"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal([]byte(body), &created))
			read := created.Data.Version
			path := fmt.Sprintf("/%d/%s/%d", student.ID, kind.notes, created.Data.ID)

			code, body = exec("PUT", path, map[string]any{"note_date": "2026-04-15", "content": "Opa holt ab", "expected_version": read})
			require.Equal(t, http.StatusOK, code, "Body: %s", body)
			code, body = exec("PUT", path, map[string]any{"note_date": "2026-04-15", "content": "Tante holt ab", "expected_version": read})
			require.Equal(t, http.StatusConflict, code, "Body: %s", body)
			assert.Contains(t, body, readstate.ChangedCode)

			current := arrivalNoteVersion
			if kind.read == "pickup" {
				current = pickupNoteVersion
			}
			version := current(t, tc, student.ID, int64(created.Data.ID), "2026-04-15")
			code, body = exec("PUT", path, map[string]any{"note_date": "2026-04-15", "content": "Tante holt ab", "expected_version": version})
			require.Equal(t, http.StatusOK, code, "Body: %s", body)
			assert.Contains(t, body, "Tante holt ab")
		})
	}
}
