package careplanhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
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

// classArrivalVersion reads the token of a class's times the way the class
// editor does: from the class read (ADR 0311).
func classArrivalVersion(t *testing.T, tc *testContext, schoolClass string) string {
	t.Helper()
	rr := authExec(t, tc, testutil.NewRequest("GET", "/class-arrival-times/"+url.PathEscape(schoolClass), nil), testutil.AdminTestClaims(1), []string{"users:read"})
	require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
	var body struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	require.NotEmpty(t, body.Data.Version, "the class read must carry the class times token")
	return body.Data.Version
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

// A wholesale replacement of the weekly pickup rows is a save of the weekly
// plan: it carries the token, a stale or missing one writes nothing (ADR 0311).
func TestWeeklyPickupReplaceRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	student := testpkg.CreateTestStudent(t, tc.db, "WeeklyPickup", "Test", "WPR1")
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Weekly", "PickupTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))
	put := func(time, version string) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d/pickup-schedules", student.ID), map[string]any{
			"schedules":        []map[string]any{{"weekday": 1, "pickup_time": time}},
			"expected_version": version,
		})
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		return rr.Code, rr.Body.String()
	}
	storedTime := func() string {
		var times []string
		require.NoError(t, tc.db.NewSelect().TableExpr("schedule.student_pickup_schedules").
			ColumnExpr("to_char(pickup_time, 'HH24:MI')").Where("student_id = ?", student.ID).
			Scan(testpkg.Ctx(t), &times))
		require.Len(t, times, 1)
		return times[0]
	}

	read := weeklyPlanVersion(t, tc, student.ID)
	code, body := put("15:30", read)
	require.Equal(t, http.StatusOK, code, "Body: %s", body)
	assert.Equal(t, "15:30", storedTime())

	code, body = put("16:00", read)
	require.Equal(t, http.StatusConflict, code, "Body: %s", body)
	assert.Contains(t, body, readstate.ChangedCode)
	code, body = put("16:00", "")
	require.Equal(t, http.StatusConflict, code, "an empty token is refused. Body: %s", body)
	assert.Equal(t, "15:30", storedTime(), "a refused replacement keeps the colleague's time")

	code, body = put("16:00", weeklyPlanVersion(t, tc, student.ID))
	require.Equal(t, http.StatusOK, code, "Body: %s", body)
	assert.Equal(t, "16:00", storedTime())
	var saved struct {
		Data struct {
			WeeklyPlanVersion string `json:"weekly_plan_version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &saved))
	assert.Equal(t, weeklyPlanVersion(t, tc, student.ID), saved.Data.WeeklyPlanVersion)
}

// The single-note route checks one note's token, not the weekly plan's, so
// it does not move a note into or within the weekly plan (ADR 0311).
func TestPickupNoteUpdateKeepsItsWeekday(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	student := testpkg.CreateTestStudent(t, tc.db, "NoteWeekday", "Test", "NWD1")
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Note", "WeekdayTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))
	exec := func(method, path string, body map[string]any) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, method, path, body)
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		return rr.Code, rr.Body.String()
	}
	create := func(body map[string]any) (string, string) {
		code, raw := exec("POST", fmt.Sprintf("/%d/pickup-notes", student.ID), body)
		require.Equal(t, http.StatusCreated, code, "Body: %s", raw)
		var created struct {
			Data struct {
				ID      testpkg.ID `json:"id"`
				Version string     `json:"version"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal([]byte(raw), &created))
		return fmt.Sprintf("/%d/pickup-notes/%d", student.ID, created.Data.ID), created.Data.Version
	}

	dated, datedVersion := create(map[string]any{"note_date": "2026-04-15", "content": "Oma holt ab"})
	code, body := exec("PUT", dated, map[string]any{"weekday": 1, "content": "Oma holt ab", "expected_version": datedVersion})
	require.Equal(t, http.StatusBadRequest, code, "a dated note does not become a weekday note. Body: %s", body)

	weekday, weekdayVersion := create(map[string]any{"weekday": 2, "content": "Dienstags bei Oma"})
	code, body = exec("PUT", weekday, map[string]any{"weekday": 3, "content": "Dienstags bei Oma", "expected_version": weekdayVersion})
	require.Equal(t, http.StatusBadRequest, code, "a weekday note does not move to another weekday. Body: %s", body)

	notes, err := tc.resource.PickupScheduleService.GetStudentPickupNotes(testpkg.Ctx(t), student.ID)
	require.NoError(t, err)
	byWeekday := map[int]string{}
	for _, note := range notes {
		byWeekday[note.Weekday] = note.Content
	}
	assert.Equal(t, map[int]string{0: "Oma holt ab", 2: "Dienstags bei Oma"}, byWeekday, "a refused move writes nothing")

	code, body = exec("PUT", dated, map[string]any{"note_date": "2026-04-16", "content": "Opa holt ab", "expected_version": datedVersion})
	require.Equal(t, http.StatusOK, code, "a dated note still moves to another day. Body: %s", body)
}

// Writing a weekday note one by one changes the weekly plan, so it waits for
// the student lock under which a plan save checks its token (ADR 0311).
func TestWeekdayPickupNoteWritesWaitForStudentLock(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Weekday", "NoteLockTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))
	exec := func(method, path string, body map[string]any) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, method, path, body)
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		return rr.Code, rr.Body.String()
	}

	t.Run("create", func(t *testing.T) {
		student := testpkg.CreateTestStudent(t, tc.db, "NoteLock", "Create", "NLC1")
		requireWaitsForStudentLock(t, tc, student.ID, http.StatusCreated, func() int {
			code, _ := exec("POST", fmt.Sprintf("/%d/pickup-notes", student.ID), map[string]any{"weekday": 1, "content": "Montags bei Oma"})
			return code
		})
	})
	t.Run("delete", func(t *testing.T) {
		student := testpkg.CreateTestStudent(t, tc.db, "NoteLock", "Delete", "NLD1")
		code, body := exec("POST", fmt.Sprintf("/%d/pickup-notes", student.ID), map[string]any{"weekday": 1, "content": "Montags bei Oma"})
		require.Equal(t, http.StatusCreated, code, "Body: %s", body)
		var created struct {
			Data struct {
				ID testpkg.ID `json:"id"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &created))
		requireWaitsForStudentLock(t, tc, student.ID, http.StatusOK, func() int {
			code, _ := exec("DELETE", fmt.Sprintf("/%d/pickup-notes/%d", student.ID, created.Data.ID), nil)
			return code
		})
	})
}

// requireWaitsForStudentLock holds the student row lock in another
// transaction and requires write to finish only after it is released.
func requireWaitsForStudentLock(t *testing.T, tc *testContext, studentID int64, want int, write func() int) {
	t.Helper()
	locked := make(chan struct{})
	release := make(chan struct{})
	lockDone := make(chan error, 1)
	go func() {
		lockDone <- testpkg.WithTenantTx(t, context.Background(), tc.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
			if _, err := testpkg.TenantQuery1(t, txCtx, testpkg.SetupTestDB(t), newStudentTestEnrollment(testpkg.NewDatabase(t, tc.db)).Student.FindByIDForUpdate, studentID); err != nil {
				return err
			}
			close(locked)
			<-release
			return nil
		})
	}()
	select {
	case <-locked:
	case err := <-lockDone:
		require.NoError(t, err)
		t.Fatal("student transaction ended before holding the lock")
	case <-time.After(2 * time.Second):
		t.Fatal("timed out while acquiring the student lock")
	}
	released := false
	releaseLock := func() {
		if !released {
			close(release)
			released = true
		}
	}
	defer releaseLock()

	writeDone := make(chan int, 1)
	go func() { writeDone <- write() }()
	select {
	case code := <-writeDone:
		t.Fatalf("the write finished with %d while the student lock was held", code)
	case <-time.After(150 * time.Millisecond):
	}
	releaseLock()
	require.NoError(t, <-lockDone)
	assert.Equal(t, want, <-writeDone)
}
