package careplanhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// A recurring weekday note must not need a pickup time (#3369): the child has
// no pickup row that weekday, stays not expected, and the note still reaches
// the day's tile through the bulk read of the effective pickup times.
func TestWeekdayPickupNoteWithoutPickupTime(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	student := testpkg.CreateTestStudent(t, tc.db, "WeekdayNote", "Test", "WDN1")
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Weekday", "NoteTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))

	body := map[string]any{"weekday": 1, "content": "Montags bei den Großeltern"}
	req := testutil.NewAuthenticatedRequest(t, "POST", fmt.Sprintf("/%d/pickup-notes", student.ID), body)
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusCreated, rr.Code, "Body: %s", rr.Body.String())

	var created struct {
		Data struct {
			ID       testpkg.ID `json:"id"`
			Weekday  int        `json:"weekday"`
			NoteDate string     `json:"note_date"`
			Version  string     `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &created))
	assert.Equal(t, 1, created.Data.Weekday)
	assert.Empty(t, created.Data.NoteDate, "a recurring note carries no date")

	t.Run("reaches_the_tile_on_every_such_weekday", func(t *testing.T) {
		for _, monday := range []calendar.Date{calendar.NewDate(2026, time.January, 26), calendar.NewDate(2026, time.February, 2)} {
			times := effectivePickups(t, tc, monday, student.ID)
			effective := times[student.ID]
			require.NotNil(t, effective, "date %s", monday)
			require.Len(t, effective.DayNotes, 1, "date %s", monday)
			assert.Equal(t, "Montags bei den Großeltern", effective.DayNotes[0].Content, "date %s", monday)
			assert.Nil(t, effective.PickupTime, "the note must not invent a pickup time")
		}
	})

	t.Run("stays_off_other_weekdays", func(t *testing.T) {
		times := effectivePickups(t, tc, calendar.NewDate(2026, time.January, 27), student.ID) // Tuesday
		if effective := times[student.ID]; effective != nil {
			assert.Empty(t, effective.DayNotes)
		}
	})

	t.Run("update_keeps_it_recurring", func(t *testing.T) {
		req := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d/pickup-notes/%d", student.ID, created.Data.ID),
			map[string]any{"weekday": 1, "content": "Montags bei Oma", "expected_version": created.Data.Version})
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
		assert.Contains(t, rr.Body.String(), `"weekday":1`)
		assert.Contains(t, rr.Body.String(), "Montags bei Oma")
	})

	t.Run("replaces_weekday_notes_without_touching_dated_notes", func(t *testing.T) {
		req := testutil.NewAuthenticatedRequest(t, "POST", fmt.Sprintf("/%d/pickup-notes", student.ID),
			map[string]any{"note_date": "2026-02-03", "content": "Nur an diesem Tag"})
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		require.Equal(t, http.StatusCreated, rr.Code, "Body: %s", rr.Body.String())

		req = testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d/pickup-notes", student.ID), map[string]any{
			"notes": []map[string]any{
				{"weekday": 1, "content": "Montags bei Tante"},
				{"weekday": 2, "content": "Dienstags zu Hause"},
			},
			"expected_version": weeklyPlanVersion(t, tc, student.ID),
		})
		rr = authExec(t, tc, req, claims, []string{"admin:*"})
		require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())

		data, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), tc.db, tc.resource.PickupScheduleService.GetStudentPickupData, student.ID)
		require.NoError(t, err)
		notes := data.Notes
		assert.Len(t, notes, 3)
		byWeekday := make(map[int]string, len(notes))
		var dated string
		for _, note := range notes {
			if note.Weekday == 0 {
				dated = note.Content
				continue
			}
			byWeekday[note.Weekday] = note.Content
		}
		assert.Equal(t, "Montags bei Tante", byWeekday[1])
		assert.Equal(t, "Dienstags zu Hause", byWeekday[2])
		assert.Equal(t, "Nur an diesem Tag", dated)
	})

	t.Run("rejects_date_and_weekday_together", func(t *testing.T) {
		req := testutil.NewAuthenticatedRequest(t, "POST", fmt.Sprintf("/%d/pickup-notes", student.ID),
			map[string]any{"weekday": 2, "note_date": "2026-01-27", "content": "x"})
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		testutil.AssertBadRequest(t, rr)
		assert.Contains(t, rr.Body.String(), "not both")
	})

	t.Run("rejects_weekend_weekday", func(t *testing.T) {
		req := testutil.NewAuthenticatedRequest(t, "POST", fmt.Sprintf("/%d/pickup-notes", student.ID),
			map[string]any{"weekday": 6, "content": "x"})
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		testutil.AssertBadRequest(t, rr)
		assert.Contains(t, rr.Body.String(), "weekday must be between")
	})

	t.Run("rejects_whitespace_only_weekday_note", func(t *testing.T) {
		req := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d/pickup-notes", student.ID), map[string]any{
			"notes": []map[string]any{{"weekday": 2, "content": " \t "}},
		})
		rr := authExec(t, tc, req, claims, []string{"admin:*"})
		testutil.AssertBadRequest(t, rr)
		assert.Contains(t, rr.Body.String(), "content is required")
	})
}

func TestReplaceWeekdayPickupNotesWaitsForStudentLock(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	student := testpkg.CreateTestStudent(t, tc.db, "WeekdayLock", "Test", "WDN3")
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Weekday", "LockTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))

	version := weeklyPlanVersion(t, tc, student.ID)
	locked := make(chan struct{})
	release := make(chan struct{})
	lockDone := make(chan error, 1)
	go func() {
		lockDone <- testpkg.WithTenantTx(t, context.Background(), tc.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
			if _, err := testpkg.TenantQuery1(t, txCtx, testpkg.SetupTestDB(t), newStudentTestEnrollment(testpkg.NewDatabase(t, tc.db)).Student.FindByIDForUpdate, student.ID); err != nil {
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
	go func() {
		req := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d/pickup-notes", student.ID), map[string]any{
			"notes":            []map[string]any{{"weekday": 1, "content": "Montags zu Hause"}},
			"expected_version": version,
		})
		writeDone <- authExec(t, tc, req, claims, []string{"admin:*"}).Code
	}()

	select {
	case code := <-writeDone:
		require.Equal(t, http.StatusOK, code, "weekday note replacement bypassed the held student lock")
		t.Fatal("weekday note replacement bypassed the held student lock")
	case <-time.After(150 * time.Millisecond):
	}

	releaseLock()
	require.NoError(t, <-lockDone)
	assert.Equal(t, http.StatusOK, <-writeDone)
}

// Where bookings decide the care days, a child without a booking that day gets
// no pickup entry at all. The day's note must survive that boundary, and it
// must do so without turning the child into an expected one (#3369).
func TestWeekdayPickupNoteSurvivesBookingBoundary(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	require.NoError(t, tc.settings().SetValue(
		testpkg.Ctx(t), settings.KeyEnrollmentBookingsAuthoritative, true, nil, nil,
	))
	t.Cleanup(func() {
		_ = tc.settings().ResetValue(testpkg.Ctx(t), settings.KeyEnrollmentBookingsAuthoritative, nil, nil)
	})
	noted := testpkg.CreateTestStudent(t, tc.db, "Unbooked", "Noted", "WDN2")
	silent := testpkg.CreateTestStudent(t, tc.db, "Unbooked", "Silent", "WDN2")
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Boundary", "NoteTeacher")
	claims := testutil.AdminTestClaims(int(account.ID))

	req := testutil.NewAuthenticatedRequest(t, "POST", fmt.Sprintf("/%d/pickup-notes", noted.ID),
		map[string]any{"weekday": 1, "content": "Montags beim Vater"})
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusCreated, rr.Code, "Body: %s", rr.Body.String())

	// The device-scan path resolves one child at a time rather than through
	// the tile's bulk read. A note-only day must survive that path too.
	single, err := testpkg.TenantQuery2(t, testpkg.Ctx(t), tc.db, tc.resource.PickupScheduleService.GetEffectivePickupTimeForDate, noted.ID, calendar.NewDate(2026, time.January, 26))
	require.NoError(t, err)
	require.NotNil(t, single)
	assert.Nil(t, single.PickupTime)
	require.Len(t, single.DayNotes, 1)
	assert.Equal(t, "Montags beim Vater", single.DayNotes[0].Content)

	// The tile reads the effective times of many children at once.
	times := effectivePickups(t, tc, calendar.NewDate(2026, time.January, 26), noted.ID, silent.ID) // Monday
	assert.NotContains(t, times, silent.ID, "a child without booking and without note stays out of the payload")
	require.Contains(t, times, noted.ID)
	assert.Nil(t, times[noted.ID].PickupTime)
	require.Len(t, times[noted.ID].DayNotes, 1)
	assert.Equal(t, "Montags beim Vater", times[noted.ID].DayNotes[0].Content)
}

// effectivePickups reads the effective pickup times of the children on one
// day the way the day views do, through Care Plan's bulk read.
func effectivePickups(t *testing.T, tc *testContext, date calendar.Date, studentIDs ...int64) map[int64]*careplan.EffectivePickupTime {
	t.Helper()
	times, err := testpkg.TenantQuery2(t, testpkg.Ctx(t), tc.db, tc.resource.PickupScheduleService.GetBulkEffectivePickupTimesForDate, studentIDs, date)
	require.NoError(t, err)
	return times
}
