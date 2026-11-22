package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The public demo opens the Anwesenheitsprotokoll and the Feedbackhistorie
// of a child (#5029); both are off by default for real schools.
func TestFullOperationProfileEnablesHistories(t *testing.T) {
	t.Parallel()
	settings := fullOperationProfileDefinition().Settings
	for _, key := range []string{profileSettingAttendanceLog, profileSettingFeedbackEnabled} {
		setting, ok := settings[key]
		require.True(t, ok, key)
		assert.JSONEq(t, `true`, string(setting.Value), key)
		assert.Equal(t, SettingManagedByTenant, setting.ManagedBy, key)
	}
}

// The seeded feedback (#5029) rates only days a child came, inside the
// window, with the day's rating at check-out and lunch after arrival.
func TestFeedbackHistoryPlanRatesPresentDays(t *testing.T) {
	t.Parallel()
	input, _ := presenceHistoryFixture()
	from, _ := feedbackHistoryRange(input.today)
	input.from = from
	days := planPresenceHistory(input).days
	entries := planFeedbackHistory(days, from)

	present := map[string]PastPresenceDay{}
	for _, day := range days {
		present[fmt.Sprintf("%s|%d", day.Date, day.StudentID)] = day
	}
	values := map[string]int{}
	mensa, students := 0, map[int64]bool{}
	for _, entry := range entries {
		day, ok := present[fmt.Sprintf("%s|%d", entry.Day, entry.StudentID)]
		require.True(t, ok, "feedback only on a present day: %+v", entry)
		require.False(t, day.Date.Before(from), "inside the window")
		values[entry.Value]++
		students[int64(entry.StudentID)] = true
		if entry.IsMensaFeedback {
			mensa++
			assert.Less(t, entry.Time, day.CheckOut.In(seedBerlinLocation()).Format("15:04:05"))
		} else {
			assert.Equal(t, day.CheckOut.In(seedBerlinLocation()).Format("15:04:05"), entry.Time)
		}
	}
	assert.Greater(t, mensa, 0, "lunch ratings fill the Mensa badge")
	assert.Greater(t, len(entries)-mensa, mensa, "more day ratings than lunch ratings")
	assert.Greater(t, len(students), 50, "most children have a history")
	assert.Greater(t, values["positive"], values["neutral"])
	assert.Greater(t, values["neutral"], values["negative"])
	assert.Positive(t, values["negative"])
	assert.Equal(t, entries, planFeedbackHistory(days, from), "the same day seeds the same feedback")
}

func TestFeedbackHistoryRangeCoversTheCurrentMonth(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		today calendar.Date
		from  calendar.Date
		until calendar.Date
	}{
		{calendar.NewDate(2026, time.February, 1), calendar.NewDate(2026, time.January, 18), calendar.NewDate(2026, time.January, 31)},
		{calendar.NewDate(2026, time.February, 14), calendar.NewDate(2026, time.January, 31), calendar.NewDate(2026, time.February, 13)},
		{calendar.NewDate(2026, time.February, 15), calendar.NewDate(2026, time.February, 1), calendar.NewDate(2026, time.February, 14)},
		{calendar.NewDate(2026, time.October, 31), calendar.NewDate(2026, time.October, 1), calendar.NewDate(2026, time.October, 30)},
	} {
		from, until := feedbackHistoryRange(tc.today)
		assert.Equal(t, tc.from, from)
		assert.Equal(t, tc.until, until)
		assert.LessOrEqual(t, from.DaysUntil(until), 29)
	}
}

// The step hands the history to the bound writer in one batch for the
// school, inside its window, and leaves a school alone whose first rated
// child already has a rating in it (#5029).
func TestSeedFeedbackHistoryStepWritesOneBatchOnce(t *testing.T) {
	t.Parallel()
	for _, existing := range []bool{false, true} {
		var askedStudent string
		srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
			w.Header().Set("Content-Type", "application/json")
			switch {
			case r.Method == http.MethodGet && (r.URL.Path == "/api/time-tracking/holidays" ||
				r.URL.Path == "/api/timetable/closing-days/" || r.URL.Path == "/api/timetable/periods/"):
				_, _ = w.Write([]byte(`{"status":"success","data":[]}`))
			case r.Method == http.MethodGet && r.URL.Path == "/api/students":
				_, _ = w.Write([]byte(`{"status":"success","data":[` + feedbackHistoryStudentRows(20) + `],"pagination":{"total_pages":1}}`))
			case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/feedback/student/"):
				askedStudent = strings.TrimPrefix(r.URL.Path, "/api/feedback/student/")
				yesterday := todaySeedDate().AddDays(-1).Format(seedDateLayout)
				if existing {
					_, _ = fmt.Fprintf(w, `{"status":"success","data":[{"id":1,"day":%q}]}`, yesterday)
					return
				}
				// Today's rating of the kiosk is no history.
				_, _ = fmt.Fprintf(w, `{"status":"success","data":[{"id":1,"day":%q}]}`, todaySeedDate().Format(seedDateLayout))
			default:
				t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			}
		})
		var school int64
		var batches [][]PastFeedback
		runtime := &Runtime{
			Client:      newTestClient(srv.URL, false),
			TenantAuth:  AuthRef{Kind: AuthBearer, Token: "tenant-token"},
			FixedSeeder: &FixedSeeder{seedDay: todaySeedDate()},
			Bootstrap:   &bootstrapSeedState{SchoolID: 9},
		}
		step := seedFeedbackHistoryStep{seeder: &Seeder{definition: fullOperationProfileDefinition(), options: SeedOptions{
			FeedbackHistory: func(_ context.Context, schoolID int64, entries []PastFeedback) (int, error) {
				school = schoolID
				batches = append(batches, entries)
				return len(entries), nil
			},
		}}}

		require.NoError(t, step.Run(context.Background(), runtime))
		srv.Close()
		require.NotEmpty(t, askedStudent)
		if existing {
			assert.Empty(t, batches, "a present history is not written twice")
			continue
		}
		require.Len(t, batches, 1)
		assert.Equal(t, runtime.Bootstrap.SchoolID, school)
		assert.Equal(t, fmt.Sprint(batches[0][0].StudentID), askedStudent, "the first rated child tells whether the history is there")
		today, err := runtime.historyToday()
		require.NoError(t, err)
		from, until := feedbackHistoryRange(today)
		mensa := 0
		for _, entry := range batches[0] {
			assert.GreaterOrEqual(t, entry.Day, from.String())
			assert.LessOrEqual(t, entry.Day, until.String())
			if entry.IsMensaFeedback {
				mensa++
			}
		}
		assert.Positive(t, mensa, "the history holds Mensa feedback")
	}
}

// Without a database writer and outside the public demo the step leaves the
// past without ratings and sends no request.
func TestSeedFeedbackHistoryStepSkipsWithoutWriter(t *testing.T) {
	t.Parallel()
	srv := newSeedHTTPTestServer(func(_ seedHTTPResponseWriter, r *seedHTTPRequest) {
		t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
	})
	defer srv.Close()
	step := seedFeedbackHistoryStep{seeder: &Seeder{definition: fullOperationProfileDefinition()}}
	require.NoError(t, step.Run(context.Background(), &Runtime{Client: newTestClient(srv.URL, false)}))
}

// In the public demo the step writes through the demo-only operator route
// as the operator (ADR 0298).
func TestOperatorFeedbackHistoryWriterUsesTheDemoRoute(t *testing.T) {
	t.Parallel()
	var path, authorization string
	var raw json.RawMessage
	var body struct {
		Entries []PastFeedback `json:"entries"`
	}
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		path, authorization = r.Method+" "+r.URL.Path, r.Header.Get("Authorization")
		require.NoError(t, json.NewDecoder(r.Body).Decode(&raw))
		require.NoError(t, json.Unmarshal(raw, &body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"status":"success","data":{"written":%d}}`, len(body.Entries))
	})
	defer srv.Close()
	runtime := &Runtime{Client: newTestClient(srv.URL, false), OperatorAuth: AuthRef{Kind: AuthBearer, Token: "operator-token"}}
	write := feedbackHistoryWriterFor(SeedOptions{PresenceHistoryRoute: true}, runtime)
	entries := []PastFeedback{{Value: "positive", Day: "2026-11-19", Time: "15:00:00", StudentID: 4}}
	written, err := write(context.Background(), 9, entries)
	require.NoError(t, err)
	assert.Equal(t, 1, written)
	assert.Equal(t, "POST /operator/schools/9/demo-feedback-history", path)
	assert.Equal(t, "Bearer operator-token", authorization)
	assert.Equal(t, entries, body.Entries)
	assert.Contains(t, string(raw), `"student_id":"4"`, "the identifier travels as text")
}

// A profile that leaves feedback off sends no request: the API would refuse
// the entries.
func TestSeedFeedbackHistoryStepSkipsSchoolsWithoutFeedback(t *testing.T) {
	t.Parallel()
	srv := newSeedHTTPTestServer(func(_ seedHTTPResponseWriter, r *seedHTTPRequest) {
		t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
	})
	defer srv.Close()
	step := seedFeedbackHistoryStep{seeder: &Seeder{definition: manualProfileDefinition()}}
	require.NoError(t, step.Run(context.Background(), &Runtime{Client: newTestClient(srv.URL, false)}))
}

func feedbackHistoryStudentRows(count int) string {
	rows := make([]string, 0, count)
	for i := range count {
		rows = append(rows, fmt.Sprintf(`{"id":%d}`, 100+i))
	}
	return strings.Join(rows, ",")
}
