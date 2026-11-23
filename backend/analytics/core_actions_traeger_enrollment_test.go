package analytics

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// contractEnrollmentRun serves the run of the enrollment of contract
// children (#7760) with body and returns the events it sent.
func contractEnrollmentRun(body string) []capturedEvent {
	tracker := &recordingTracker{}
	root := chi.NewRouter()
	root.Use(CoreActionMiddleware(CoreActionConfig{
		Policy:       CollectionPolicy{SchoolEnabled: func(context.Context, int64) (bool, error) { return true, nil }},
		Tracker:      tracker,
		RequestActor: func(*http.Request) (Actor, bool) { return staffActor, true },
	}))
	enrollments := chi.NewRouter()
	enrollments.Post("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	})
	root.Mount("/traeger/contract-enrollments", enrollments)
	serve(root, http.MethodPost, "/traeger/contract-enrollments/", `{}`, nil)
	return tracker.captured()
}

func contractEnrollmentAnswer(changed string, rows int) string {
	row := `{"contract_id":"1","status":"done","contract_child":{"first_name":"","last_name":""},"bookings":[],"changes":[]}`
	return `{"status":"success","data":{"school_id":"7","changed":` + changed + `,"counts":{"done":1},"rows":[` +
		strings.TrimSuffix(strings.Repeat(row+",", rows), ",") + `]},"message":"Contract children enrolled"}`
}

// The run counts only when it committed something: a run that found every
// contract done answers changed=false and is no core action.
func TestContractChildrenEnrolledCountsOnlyACommittedChange(t *testing.T) {
	t.Parallel()

	events := contractEnrollmentRun(contractEnrollmentAnswer("true", 2))
	require.Len(t, events, 1)
	assert.Equal(t, "contract_children_enrolled", events[0].event)

	assert.Empty(t, contractEnrollmentRun(contractEnrollmentAnswer("false", 2)), "a run that changed nothing")
	assert.Empty(t, contractEnrollmentRun(`{"status":"success","data":{"school_id":"7","counts":{},"rows":[]}}`), "an answer without the flag")
}

// A school with many contracts answers with more than the middleware keeps.
// The flag stands before the rows and is read from the start.
func TestContractChildrenEnrolledCountsALongAnswer(t *testing.T) {
	t.Parallel()

	long := contractEnrollmentAnswer("true", 1000)
	require.Greater(t, len(long), sessionBodyLimit)
	events := contractEnrollmentRun(long)
	require.Len(t, events, 1)
	assert.Equal(t, "contract_children_enrolled", events[0].event)

	assert.Empty(t, contractEnrollmentRun(contractEnrollmentAnswer("false", 1000)), "a long answer that changed nothing")
	behind := `{"status":"success","data":{"rows":[` + strings.Repeat(`{"contract_id":"1"},`, 5000) + `{}],"changed":true}}`
	require.Greater(t, len(behind), sessionBodyLimit)
	assert.Empty(t, contractEnrollmentRun(behind), "a flag behind the cut is not read")
}
