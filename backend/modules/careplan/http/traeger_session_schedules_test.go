package careplanhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// traegerSchoolClaims is the session the Absprung of the Träger-Büro opens
// (ADR 0084 section 5): the school's admin role, the mark via_traeger, and an
// account that is nobody's person or staff member at the school.
func traegerSchoolClaims(t *testing.T, tc *testContext) sessiontoken.AppClaims {
	t.Helper()
	account := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("traeger-buero-%d@example.com", testpkg.UniqueSuffix()))
	claims := testutil.AdminTestClaims(int(account.ID))
	claims.ViaTraeger = true
	return claims
}

func traegerExec(t *testing.T, tc *testContext, claims sessiontoken.AppClaims, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	return authExec(t, tc, testutil.NewAuthenticatedRequest(t, method, path, body), claims, []string{"admin:*"})
}

// TestTraegerSchoolSessionSavesWeeklyPlan pins #7766: a person who came through
// the Träger-Portal holds the school's admin role and must be able to save a
// child's weekly plan, although no staff record names them at the school.
func TestTraegerSchoolSessionSavesWeeklyPlan(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, fixedCalendarClock)
	student := testpkg.CreateTestStudent(t, tc.db, "Traeger", "Wochenplan", "TW1")
	claims := traegerSchoolClaims(t, tc)
	body := map[string]any{
		"schedules":         []map[string]any{{"weekday": 1, "pickup_time": "13:45"}},
		"arrival_schedules": []map[string]any{{"weekday": 1, "expected_arrival": "11:30"}},
		"care_days":         []int{1},
		"effective_from":    studentsTestToday.String(),
	}

	preview := traegerExec(t, tc, claims, http.MethodPost, fmt.Sprintf("/%d/pickup-schedules/preview", student.ID), body)
	require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
	var envelope struct {
		Data struct {
			PreviewToken string `json:"preview_token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(preview.Body.Bytes(), &envelope))
	body["preview_token"] = envelope.Data.PreviewToken

	apply := traegerExec(t, tc, claims, http.MethodPost, fmt.Sprintf("/%d/pickup-schedules/apply", student.ID), body)
	require.Equal(t, http.StatusOK, apply.Code, apply.Body.String())

	// The plan is still there when the person opens the child again.
	pickups := traegerExec(t, tc, claims, http.MethodGet, fmt.Sprintf("/%d/pickup-schedules", student.ID), nil)
	require.Equal(t, http.StatusOK, pickups.Code, pickups.Body.String())
	assert.Contains(t, pickups.Body.String(), `"pickup_time":"13:45"`)
	arrivals := traegerExec(t, tc, claims, http.MethodGet, fmt.Sprintf("/%d/arrival-schedules", student.ID), nil)
	require.Equal(t, http.StatusOK, arrivals.Code, arrivals.Body.String())
	assert.Contains(t, arrivals.Body.String(), `"expected_arrival":"11:30"`)
}

// careRowAuthor is the author of one care-plan row: a staff member of the
// school, or the mark of the Träger-Büro (#7766).
type careRowAuthor struct {
	CreatedBy        *int64 `bun:"created_by"`
	EnteredByTraeger bool   `bun:"entered_by_traeger"`
}

// careRowAuthors reads the authors of the child's rows in one schedule table
// of this test's tenant; narrow limits them further (nil: all rows).
func careRowAuthors(t *testing.T, tc *testContext, table string, studentID int64, narrow func(*bun.SelectQuery) *bun.SelectQuery) []careRowAuthor {
	t.Helper()
	var rows []careRowAuthor
	query := tc.db.NewSelect().TableExpr("schedule."+table).
		ColumnExpr("created_by, entered_by_traeger").
		Where("tenant_id = ?", testpkg.Tenant(t)).
		Where("student_id = ?", studentID).
		OrderExpr("id")
	if narrow != nil {
		query = narrow(query)
	}
	require.NoError(t, query.Scan(context.Background(), &rows))
	return rows
}

// assertTraegerAuthored requires at least one matching row, each without a
// staff author and with the mark of the Träger-Büro.
func assertTraegerAuthored(t *testing.T, tc *testContext, table string, studentID int64, narrow func(*bun.SelectQuery) *bun.SelectQuery) {
	t.Helper()
	rows := careRowAuthors(t, tc, table, studentID, narrow)
	require.NotEmpty(t, rows, "no %s row written", table)
	for _, row := range rows {
		assert.Nil(t, row.CreatedBy, "%s: a row of the Träger-Büro names no staff member", table)
		assert.True(t, row.EnteredByTraeger, "%s: a row of the Träger-Büro carries its mark", table)
	}
}

// assertStaffAuthored requires at least one matching row, each authored by
// staffID and without the mark of the Träger-Büro.
func assertStaffAuthored(t *testing.T, tc *testContext, table string, studentID, staffID int64, narrow func(*bun.SelectQuery) *bun.SelectQuery) {
	t.Helper()
	rows := careRowAuthors(t, tc, table, studentID, narrow)
	require.NotEmpty(t, rows, "no %s row written", table)
	for _, row := range rows {
		if assert.NotNil(t, row.CreatedBy, "%s: a staff row keeps its staff author", table) {
			assert.Equal(t, staffID, *row.CreatedBy, "%s: a staff row keeps its staff author", table)
		}
		assert.False(t, row.EnteredByTraeger, "%s: a staff row carries no mark of the Träger-Büro", table)
	}
}

func onDate(column string, date calendar.Date) func(*bun.SelectQuery) *bun.SelectQuery {
	return func(q *bun.SelectQuery) *bun.SelectQuery { return q.Where("? = ?", bun.Ident(column), date) }
}

func onWeekday(weekday int) func(*bun.SelectQuery) *bun.SelectQuery {
	return func(q *bun.SelectQuery) *bun.SelectQuery { return q.Where("weekday = ?", weekday) }
}

// requireTraegerWrite sends one write of the Träger session and requires the
// expected status.
func requireTraegerWrite(t *testing.T, tc *testContext, claims sessiontoken.AppClaims, method, path string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	rr := traegerExec(t, tc, claims, method, path, body)
	require.Equal(t, want, rr.Code, "%s %s: %s", method, path, rr.Body.String())
	return rr
}

// TestTraegerSchoolSessionWritesCarePlanWithMark pins #7766 on every care-plan
// write that names its author: the Träger session saves, and each row carries
// the mark instead of a staff member. Rows of both authors stay valid when the
// other side edits or replaces them.
func TestTraegerSchoolSessionWritesCarePlanWithMark(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, fixedCalendarClock)
	claims := traegerSchoolClaims(t, tc)
	child := testpkg.CreateTestStudent(t, tc.db, "Traeger", "Eintrag", "TE1")
	bulkChild := testpkg.CreateTestStudent(t, tc.db, "Traeger", "Sammel", "TE2")
	teacher, staffAccount := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Traeger", "Kollegin")
	staffClaims := testutil.AdminTestClaims(int(staffAccount.ID))
	staffExec := func(method, path string, body any) *httptest.ResponseRecorder {
		return authExec(t, tc, testutil.NewAuthenticatedRequest(t, method, path, body), staffClaims, []string{"admin:*"})
	}

	// studentsTestToday is a Monday; every date below is a later school day.
	arrivalExceptionDay := studentsTestToday.AddDays(1)
	pickupExceptionDay := studentsTestToday.AddDays(2)
	partialAbsenceDay := studentsTestToday.AddDays(3)
	departureDay := studentsTestToday.AddDays(4)
	noteDay := studentsTestToday.AddDays(8)
	base := fmt.Sprintf("/%d", child.ID)

	t.Run("weekly_arrival_times", func(t *testing.T) {
		requireTraegerWrite(t, tc, claims, http.MethodPut, base+"/arrival-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 1, "expected_arrival": "11:45"}},
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_arrival_schedules", child.ID, nil)
	})

	t.Run("arrival_exception_create_and_update", func(t *testing.T) {
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, base+"/arrival-exceptions", map[string]any{
			"exception_date": arrivalExceptionDay.String(), "expected_arrival": "09:00", "reason": "Arzttermin",
		}, http.StatusCreated)
		assertTraegerAuthored(t, tc, "student_arrival_exceptions", child.ID, onDate("exception_date", arrivalExceptionDay))

		requireTraegerWrite(t, tc, claims, http.MethodPut, fmt.Sprintf("%s/arrival-exceptions/%d", base, partialAbsenceResponseID(t, rr.Body.Bytes())), map[string]any{
			"exception_date": arrivalExceptionDay.String(), "expected_arrival": "09:30", "reason": "Arzttermin später",
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_arrival_exceptions", child.ID, onDate("exception_date", arrivalExceptionDay))
	})

	var arrivalNoteID int64
	t.Run("arrival_note_create_and_update", func(t *testing.T) {
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, base+"/arrival-notes", map[string]any{
			"note_date": noteDay.String(), "content": "Kommt mit dem Bus",
		}, http.StatusCreated)
		arrivalNoteID = partialAbsenceResponseID(t, rr.Body.Bytes())
		assertTraegerAuthored(t, tc, "student_arrival_notes", child.ID, nil)

		requireTraegerWrite(t, tc, claims, http.MethodPut, fmt.Sprintf("%s/arrival-notes/%d", base, arrivalNoteID), map[string]any{
			"note_date": noteDay.String(), "content": "Kommt mit dem späteren Bus",
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_arrival_notes", child.ID, nil)
	})

	t.Run("bulk_arrival_times_per_child", func(t *testing.T) {
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, "/arrival-schedules/bulk", map[string]any{
			"student_ids": []int64{bulkChild.ID},
			"schedules":   []map[string]any{{"weekday": 2, "expected_arrival": "11:15"}},
		}, http.StatusOK)
		assert.Contains(t, rr.Body.String(), `"students_affected":1`)
		assertTraegerAuthored(t, tc, "student_arrival_schedules", bulkChild.ID, nil)
	})

	t.Run("weekly_pickup_times", func(t *testing.T) {
		requireTraegerWrite(t, tc, claims, http.MethodPut, base+"/pickup-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 1, "pickup_time": "15:30"}},
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_pickup_schedules", child.ID, nil)
	})

	t.Run("bulk_pickup_times", func(t *testing.T) {
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, "/pickup-schedules/bulk", map[string]any{
			"student_ids": []int64{bulkChild.ID},
			"schedules":   []map[string]any{{"weekday": 2, "pickup_time": "16:20"}},
		}, http.StatusOK)
		assert.Contains(t, rr.Body.String(), `"students_affected":1`)
		assertTraegerAuthored(t, tc, "student_pickup_schedules", bulkChild.ID, nil)
	})

	t.Run("pickup_exception_create_and_update", func(t *testing.T) {
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, base+"/pickup-exceptions", map[string]any{
			"exception_date": pickupExceptionDay.String(), "pickup_time": "12:00", "reason": "Arzttermin",
		}, http.StatusCreated)
		assertTraegerAuthored(t, tc, "student_pickup_exceptions", child.ID, onDate("exception_date", pickupExceptionDay))

		requireTraegerWrite(t, tc, claims, http.MethodPut, fmt.Sprintf("%s/pickup-exceptions/%d", base, partialAbsenceResponseID(t, rr.Body.Bytes())), map[string]any{
			"exception_date": pickupExceptionDay.String(), "pickup_time": "12:30", "reason": "Arzttermin später",
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_pickup_exceptions", child.ID, onDate("exception_date", pickupExceptionDay))
	})

	var pickupNoteID int64
	t.Run("pickup_notes_dated_and_weekly", func(t *testing.T) {
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, base+"/pickup-notes", map[string]any{
			"note_date": noteDay.String(), "content": "Oma holt ab",
		}, http.StatusCreated)
		pickupNoteID = partialAbsenceResponseID(t, rr.Body.Bytes())
		assertTraegerAuthored(t, tc, "student_pickup_notes", child.ID, onDate("note_date", noteDay))

		requireTraegerWrite(t, tc, claims, http.MethodPut, fmt.Sprintf("%s/pickup-notes/%d", base, pickupNoteID), map[string]any{
			"note_date": noteDay.String(), "content": "Opa holt ab",
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_pickup_notes", child.ID, onDate("note_date", noteDay))

		requireTraegerWrite(t, tc, claims, http.MethodPut, base+"/pickup-notes", map[string]any{
			"notes": []map[string]any{{"weekday": 3, "content": "Mittwochs beim Vater"}},
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_pickup_notes", child.ID, onWeekday(3))
	})

	t.Run("partial_absence_create_and_update", func(t *testing.T) {
		onPartialAbsenceDay := onDate("exception_date", partialAbsenceDay)
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, base+"/partial-absences", map[string]any{
			"date": partialAbsenceDay.String(), "from_time": "13:30", "reason": "Arzttermin",
		}, http.StatusCreated)
		assertTraegerExcused(t, tc, child.ID, partialAbsenceDay)
		assertTraegerAuthored(t, tc, "student_pickup_exceptions", child.ID, onPartialAbsenceDay)

		requireTraegerWrite(t, tc, claims, http.MethodPut, fmt.Sprintf("%s/partial-absences/%d", base, partialAbsenceResponseID(t, rr.Body.Bytes())), map[string]any{
			"date": partialAbsenceDay.String(), "from_time": "14:30", "reason": "Späterer Arzttermin",
			"expected_version": partialAbsenceResponseVersion(t, rr.Body.Bytes()),
		}, http.StatusOK)
		assertTraegerExcused(t, tc, child.ID, partialAbsenceDay)
		assertTraegerAuthored(t, tc, "student_pickup_exceptions", child.ID, onPartialAbsenceDay)
	})

	t.Run("departure_exception", func(t *testing.T) {
		requireTraegerWrite(t, tc, claims, http.MethodPut, fmt.Sprintf("%s/departure-exceptions/%s", base, departureDay), map[string]any{
			"departure_mode": "bus", "reason": "Vater hat angerufen",
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_departure_exceptions", child.ID, onDate("exception_date", departureDay))
	})

	t.Run("create_child_with_weekly_times", func(t *testing.T) {
		rr := requireTraegerWrite(t, tc, claims, http.MethodPost, "/", map[string]any{
			"first_name": "Traeger", "last_name": "Neuaufnahme", "school_class": "1a",
			"arrival_schedules": []map[string]any{{"weekday": 1, "expected_arrival": "07:30"}},
			"pickup_schedules":  []map[string]any{{"weekday": 1, "pickup_time": "15:00"}},
		}, http.StatusCreated)
		var created createStudentResponse
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &created))
		require.Positive(t, int64(created.Data.ID))
		assertTraegerAuthored(t, tc, "student_arrival_schedules", int64(created.Data.ID), nil)
		assertTraegerAuthored(t, tc, "student_pickup_schedules", int64(created.Data.ID), nil)
	})

	// A staff admin edits notes the Träger-Büro entered: the rows stay the
	// Träger-Büro's and keep satisfying the author checks.
	t.Run("staff_edits_notes_of_the_traeger_buero", func(t *testing.T) {
		require.Positive(t, pickupNoteID)
		require.Positive(t, arrivalNoteID)
		rr := staffExec(http.MethodPut, fmt.Sprintf("%s/pickup-notes/%d", base, pickupNoteID), map[string]any{
			"note_date": noteDay.String(), "content": "Tante holt ab",
		})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assertTraegerAuthored(t, tc, "student_pickup_notes", child.ID, onDate("note_date", noteDay))

		rr = staffExec(http.MethodPut, fmt.Sprintf("%s/arrival-notes/%d", base, arrivalNoteID), map[string]any{
			"note_date": noteDay.String(), "content": "Kommt zu Fuß",
		})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assertTraegerAuthored(t, tc, "student_arrival_notes", child.ID, nil)
	})

	// A staff admin writes the weekly plan as before; the Träger-Büro then
	// saves it again. Saving the weekly plan replaces its rows, so whoever
	// saved last is their author, a staff member and the Träger-Büro alike.
	t.Run("traeger_buero_saves_rows_of_staff_again", func(t *testing.T) {
		staffChild := testpkg.CreateTestStudent(t, tc.db, "Traeger", "Kollegin", "TE3")
		staffBase := fmt.Sprintf("/%d", staffChild.ID)

		rr := staffExec(http.MethodPut, staffBase+"/pickup-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 2, "pickup_time": "15:00"}},
		})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assertStaffAuthored(t, tc, "student_pickup_schedules", staffChild.ID, teacher.StaffID, nil)
		rr = staffExec(http.MethodPut, staffBase+"/arrival-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 2, "expected_arrival": "11:00"}},
		})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assertStaffAuthored(t, tc, "student_arrival_schedules", staffChild.ID, teacher.StaffID, nil)

		requireTraegerWrite(t, tc, claims, http.MethodPut, staffBase+"/pickup-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 2, "pickup_time": "16:00"}},
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_pickup_schedules", staffChild.ID, nil)
		requireTraegerWrite(t, tc, claims, http.MethodPut, staffBase+"/arrival-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 2, "expected_arrival": "11:30"}},
		}, http.StatusOK)
		assertTraegerAuthored(t, tc, "student_arrival_schedules", staffChild.ID, nil)

		// The re-save took effect.
		pickups := traegerExec(t, tc, claims, http.MethodGet, staffBase+"/pickup-schedules", nil)
		require.Equal(t, http.StatusOK, pickups.Code, pickups.Body.String())
		assert.Contains(t, pickups.Body.String(), `"pickup_time":"16:00"`)
		arrivals := traegerExec(t, tc, claims, http.MethodGet, staffBase+"/arrival-schedules", nil)
		require.Equal(t, http.StatusOK, arrivals.Code, arrivals.Body.String())
		assert.Contains(t, arrivals.Body.String(), `"expected_arrival":"11:30"`)

		// A bulk change writes over the existing weekday row. Author and mark
		// change together, in both directions: never a staff member and the
		// mark on one row, never neither.
		bulk := func(times map[string]string) map[string]any {
			schedule := map[string]any{"weekday": 2}
			for field, value := range times {
				schedule[field] = value
			}
			return map[string]any{"student_ids": []int64{staffChild.ID}, "schedules": []map[string]any{schedule}}
		}
		rr = staffExec(http.MethodPost, "/pickup-schedules/bulk", bulk(map[string]string{"pickup_time": "16:10"}))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assertStaffAuthored(t, tc, "student_pickup_schedules", staffChild.ID, teacher.StaffID, nil)
		rr = staffExec(http.MethodPost, "/arrival-schedules/bulk", bulk(map[string]string{"expected_arrival": "11:40"}))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assertStaffAuthored(t, tc, "student_arrival_schedules", staffChild.ID, teacher.StaffID, nil)

		requireTraegerWrite(t, tc, claims, http.MethodPost, "/pickup-schedules/bulk", bulk(map[string]string{"pickup_time": "16:20"}), http.StatusOK)
		assertTraegerAuthored(t, tc, "student_pickup_schedules", staffChild.ID, nil)
		requireTraegerWrite(t, tc, claims, http.MethodPost, "/arrival-schedules/bulk", bulk(map[string]string{"expected_arrival": "11:50"}), http.StatusOK)
		assertTraegerAuthored(t, tc, "student_arrival_schedules", staffChild.ID, nil)
	})
}

// assertTraegerExcused requires the partial absence of date to name no staff
// member and to carry the mark of the Träger-Büro.
func assertTraegerExcused(t *testing.T, tc *testContext, studentID int64, date calendar.Date) {
	t.Helper()
	var rows []struct {
		ExcusedCreatedBy *int64 `bun:"excused_created_by"`
		ExcusedByTraeger bool   `bun:"excused_by_traeger"`
	}
	require.NoError(t, tc.db.NewSelect().TableExpr("schedule.student_pickup_exceptions").
		ColumnExpr("excused_created_by, excused_by_traeger").
		Where("tenant_id = ?", testpkg.Tenant(t)).
		Where("student_id = ?", studentID).
		Where("exception_date = ?", date).
		Where("excused_from IS NOT NULL").
		Scan(context.Background(), &rows))
	require.Len(t, rows, 1, "one partial absence on %s", date)
	assert.Nil(t, rows[0].ExcusedCreatedBy, "a partial absence of the Träger-Büro names no staff member")
	assert.True(t, rows[0].ExcusedByTraeger, "a partial absence of the Träger-Büro carries its mark")
}

// TestTraegerSchoolSessionLeavesOthersExcluded pins the other side of #7766: an
// account without staff record and without the Träger mark still cannot
// write, and the Träger session still needs the write right.
func TestTraegerSchoolSessionLeavesOthersExcluded(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, fixedCalendarClock)
	child := testpkg.CreateTestStudent(t, tc.db, "Traeger", "Ausschluss", "TX1")
	base := fmt.Sprintf("/%d", child.ID)
	assertNothingWritten := func(t *testing.T) {
		t.Helper()
		for _, table := range []string{"student_pickup_schedules", "student_arrival_schedules", "student_pickup_exceptions", "student_arrival_exceptions"} {
			assert.Empty(t, careRowAuthors(t, tc, table, child.ID, nil), "%s must stay empty", table)
		}
	}

	t.Run("admin_without_staff_record_and_without_traeger_mark", func(t *testing.T) {
		account := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("ohne-personal-%d@example.com", testpkg.UniqueSuffix()))
		claims := testutil.AdminTestClaims(int(account.ID))
		require.False(t, claims.ViaTraeger)
		body := map[string]any{
			"schedules":         []map[string]any{{"weekday": 1, "pickup_time": "13:45"}},
			"arrival_schedules": []map[string]any{{"weekday": 1, "expected_arrival": "11:30"}},
			"care_days":         []int{1},
			"effective_from":    studentsTestToday.String(),
		}
		preview := traegerExec(t, tc, claims, http.MethodPost, base+"/pickup-schedules/preview", body)
		require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
		var envelope struct {
			Data struct {
				PreviewToken string `json:"preview_token"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(preview.Body.Bytes(), &envelope))
		body["preview_token"] = envelope.Data.PreviewToken

		apply := traegerExec(t, tc, claims, http.MethodPost, base+"/pickup-schedules/apply", body)
		require.Equal(t, http.StatusForbidden, apply.Code, apply.Body.String())
		assert.Contains(t, apply.Body.String(), `"code":"students.schedule_staff_profile_required"`)

		arrivals := traegerExec(t, tc, claims, http.MethodPut, base+"/arrival-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 1, "expected_arrival": "11:30"}},
		})
		require.Equal(t, http.StatusForbidden, arrivals.Code, arrivals.Body.String())
		assert.Contains(t, arrivals.Body.String(), `"code":"students.schedule_staff_profile_required"`)
		assertNothingWritten(t)
	})

	t.Run("traeger_session_without_write_right", func(t *testing.T) {
		claims := traegerSchoolClaims(t, tc)
		req := testutil.NewAuthenticatedRequest(t, http.MethodPut, base+"/pickup-schedules", map[string]any{
			"schedules": []map[string]any{{"weekday": 1, "pickup_time": "15:30"}},
		})
		rr := authExec(t, tc, req, claims, []string{"users:read"})
		require.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())
		assertNothingWritten(t)
	})
}

// TestTraegerSchoolSessionApprovesParentWeeklyRequest pins the same defect one
// layer down (#7766): approving a family's weekly request writes the plan in
// the name of the deciding person, and the Träger-Büro has no staff record to
// name. The approval goes through and the row carries the mark.
func TestTraegerSchoolSessionApprovesParentWeeklyRequest(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	chain := testpkg.CreateTestParentGuardianChain(t, tc.db)
	claims := traegerSchoolClaims(t, tc)

	tenantCtx := tenant.WithTenantID(testpkg.WithPackageTenantRuntime(context.Background()), chain.TenantID)
	pending, err := testpkg.TenantQuery3(t, tenantCtx, tc.db, tc.careRequests.CreateRequest, chain.StudentID, chain.AccountID,
		json.RawMessage(`{"weekdays":[{"weekday":3,"pickup":"16:00"}]}`))
	require.NoError(t, err)
	token, _ := openWeeklyBaseline(t, tc, claims, chain.StudentID, pending.ID)

	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("/care-schedule-change-requests/%d/decide", pending.ID),
		strings.NewReader(fmt.Sprintf(`{"approve":true,"reason":"Passt so","impact_token":%q,"expected_version":%q}`, token, testpkg.CareRequestVersion(t, pending.ID))))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	assertTraegerAuthored(t, tc, "student_pickup_schedules", chain.StudentID, onWeekday(3))
}

// An ordinary admin account without a staff record, outside a session of the
// Träger-Büro, still may not decide a family's request. The refusal names
// the missing staff profile, so the screen can say what to fix (#7818).
func TestSchoolSessionWithoutStaffRecordCannotApproveParentWeeklyRequest(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	chain := testpkg.CreateTestParentGuardianChain(t, tc.db)
	account := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("admin-ohne-personal-%d@example.com", testpkg.UniqueSuffix()))
	claims := testutil.AdminTestClaims(int(account.ID))

	tenantCtx := tenant.WithTenantID(testpkg.WithPackageTenantRuntime(context.Background()), chain.TenantID)
	pending, err := testpkg.TenantQuery3(t, tenantCtx, tc.db, tc.careRequests.CreateRequest, chain.StudentID, chain.AccountID,
		json.RawMessage(`{"weekdays":[{"weekday":3,"pickup":"16:00"}]}`))
	require.NoError(t, err)
	token, _ := openWeeklyBaseline(t, tc, claims, chain.StudentID, pending.ID)

	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("/care-schedule-change-requests/%d/decide", pending.ID),
		strings.NewReader(fmt.Sprintf(`{"approve":true,"reason":"Passt so","impact_token":%q,"expected_version":%q}`, token, testpkg.CareRequestVersion(t, pending.ID))))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"code":"students.schedule_staff_profile_required"`)
	assert.Empty(t, careRowAuthors(t, tc, "student_pickup_schedules", chain.StudentID, onWeekday(3)), "the refused approval writes no row")
}

// A day a parent set from the parents portal is taken over by the next staff
// write. The Träger-Büro takes it over the same way: the row becomes a staff
// entry without a staff author and with the mark, on a create over the day
// and on an update of the row.
func TestTraegerSchoolSessionTakesOverParentDay(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, fixedCalendarClock)
	chain := testpkg.CreateTestParentGuardianChain(t, tc.db)
	claims := traegerSchoolClaims(t, tc)
	base := fmt.Sprintf("/%d", chain.StudentID)
	createDay, updateDay := studentsTestToday.AddDays(1), studentsTestToday.AddDays(2)
	reason := "Von den Eltern"

	parentDay := func(date calendar.Date) int64 {
		return testpkg.InsertStudentPickupExceptionRow(t, tc.db, testpkg.StudentPickupExceptionRow{
			TenantID: chain.TenantID, StudentID: chain.StudentID, ExceptionDate: date,
			Reason: &reason, Source: careplan.ExceptionSourceGuardian, CreatedByGuardian: &chain.AccountID,
		}).ID
	}
	assertTakenOver := func(date calendar.Date) {
		assertTraegerAuthored(t, tc, "student_pickup_exceptions", chain.StudentID, onDate("exception_date", date))
		var sources []string
		require.NoError(t, tc.db.NewSelect().TableExpr("schedule.student_pickup_exceptions").ColumnExpr("source").
			Where("student_id = ?", chain.StudentID).Where("exception_date = ?", date).Scan(context.Background(), &sources))
		require.Equal(t, []string{careplan.ExceptionSourceStaff}, sources)
	}

	parentDay(createDay)
	requireTraegerWrite(t, tc, claims, http.MethodPost, base+"/pickup-exceptions", map[string]any{
		"exception_date": createDay.String(), "pickup_time": "13:45", "reason": "Vom Träger-Büro",
	}, http.StatusCreated)
	assertTakenOver(createDay)

	requireTraegerWrite(t, tc, claims, http.MethodPut, fmt.Sprintf("%s/pickup-exceptions/%d", base, parentDay(updateDay)), map[string]any{
		"exception_date": updateDay.String(), "pickup_time": "14:15", "reason": "Vom Träger-Büro",
	}, http.StatusOK)
	assertTakenOver(updateDay)
}
