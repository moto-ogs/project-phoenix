package analytics

import (
	"context"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// firstStepsWorld is the school switch, the person's consent and the answer
// of the first steps' routes for one test.
type firstStepsWorld struct {
	schoolEnabled bool
	consent       bool
	status        int
	body          string
}

func defaultFirstStepsWorld(body string) firstStepsWorld {
	return firstStepsWorld{schoolEnabled: true, consent: true, status: http.StatusOK, body: body}
}

// newFirstStepsRouter mounts the first steps' routes as the root does, with
// the middleware router-wide and gates for the school and the consent.
func newFirstStepsRouter(tracker Tracker, world firstStepsWorld) http.Handler {
	staff := Actor{Surface: SurfaceOGS, Role: RoleStaff, SchoolID: 42, AccountID: 7}
	root := chi.NewRouter()
	root.Use(CoreActionMiddleware(CoreActionConfig{
		Policy: CollectionPolicy{
			SchoolEnabled: func(context.Context, int64) (bool, error) { return world.schoolEnabled, nil },
		},
		Tracker:      tracker,
		RequestActor: func(*http.Request) (Actor, bool) { return staff, true },
		Consent:      func(context.Context, int64) bool { return world.consent },
	}))
	answer := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(world.status)
		_, _ = w.Write([]byte(world.body))
	}
	root.Route("/api", func(r chi.Router) {
		onboarding := chi.NewRouter()
		onboarding.Put("/steps/{step}", answer)
		onboarding.Put("/dismissal", answer)
		r.Mount("/staff-onboarding", onboarding)
	})
	return root
}

func firstStepsStatus(dismissed bool, done, skipped string) string {
	dismissedJSON := "false"
	if dismissed {
		dismissedJSON = "true"
	}
	return `{"status":"success","data":{"changed":true,"dismissed":` + dismissedJSON +
		`,"school_ready":true,"done_steps":[` + done + `],"skipped_steps":[` + skipped + `]}}`
}

func TestStaffFirstStepCountsWhatHappenedToTheStep(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		body   string
		action string
	}{
		{"done", firstStepsStatus(false, `"students","groups"`, ``), "done"},
		{"skipped", firstStepsStatus(false, `"students"`, `"groups"`), "skipped"},
		{"opened again", firstStepsStatus(false, `"students"`, ``), "reopened"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			tracker := &recordingTracker{}
			rec := serve(newFirstStepsRouter(tracker, defaultFirstStepsWorld(tc.body)), http.MethodPut,
				"/api/staff-onboarding/steps/groups", `{"state":"free text"}`, map[string]string{SessionIDHeader: testSessionID})
			require.Equal(t, http.StatusOK, rec.Code)

			events := tracker.captured()
			require.Len(t, events, 1)
			assert.Equal(t, "staff_first_step_changed", events[0].event)
			assert.Equal(t, "school:42", events[0].distinctID)
			assert.Equal(t, testSessionID, events[0].sessionID)
			assert.Equal(t, map[string]any{
				"surface": SurfaceOGS, "role": RoleStaff, "school_id": "42",
				"step": "groups", "action": tc.action,
			}, events[0].props)
		})
	}
}

func TestStaffFirstStepsCountTheirHiding(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		target string
		body   string
		event  string
	}{
		{"finished", "/api/staff-onboarding/dismissal?outcome=completed", firstStepsStatus(true, `"groups"`, ``), "staff_first_steps_completed"},
		{"closed early", "/api/staff-onboarding/dismissal", firstStepsStatus(true, ``, ``), "staff_first_steps_dismissed"},
		{"unknown outcome", "/api/staff-onboarding/dismissal?outcome=Bärengruppe", firstStepsStatus(true, ``, ``), "staff_first_steps_dismissed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			tracker := &recordingTracker{}
			serve(newFirstStepsRouter(tracker, defaultFirstStepsWorld(tc.body)), http.MethodPut, tc.target, `{"dismissed":true}`, nil)

			events := tracker.captured()
			require.Len(t, events, 1)
			assert.Equal(t, tc.event, events[0].event)
			assert.Equal(t, map[string]any{"surface": SurfaceOGS, "role": RoleStaff, "school_id": "42"}, events[0].props,
				"the query value never leaves as a property")
		})
	}
}

func TestStaffFirstStepsCountOnlyChangedResponses(t *testing.T) {
	t.Parallel()

	body := `{"status":"success","data":{"changed":false,"dismissed":true,"done_steps":["groups"],"skipped_steps":[]}}`
	for _, target := range []string{
		"/api/staff-onboarding/steps/groups",
		"/api/staff-onboarding/dismissal?outcome=completed",
	} {
		tracker := &recordingTracker{}
		serve(newFirstStepsRouter(tracker, defaultFirstStepsWorld(body)), http.MethodPut, target, `{}`, nil)
		assert.Empty(t, tracker.captured(), "an idempotent response counts no onboarding transition: %s", target)
	}
}

func TestStaffFirstStepsSendNothingWithoutACountableAnswer(t *testing.T) {
	t.Parallel()

	failed := defaultFirstStepsWorld(`{"status":"error","code":"general.not_found"}`)
	failed.status = http.StatusNotFound
	serverError := defaultFirstStepsWorld(firstStepsStatus(false, `"groups"`, ``))
	serverError.status = http.StatusInternalServerError
	cases := []struct {
		name   string
		world  firstStepsWorld
		target string
	}{
		{"step write failed", failed, "/api/staff-onboarding/steps/groups"},
		{"dismissal failed", serverError, "/api/staff-onboarding/dismissal"},
		{"unknown step", defaultFirstStepsWorld(firstStepsStatus(false, `"kids"`, ``)), "/api/staff-onboarding/steps/kids"},
		{"response without the step lists", defaultFirstStepsWorld(`{"status":"success","data":{"dismissed":true}}`), "/api/staff-onboarding/steps/groups"},
		{"malformed response", defaultFirstStepsWorld(`not json`), "/api/staff-onboarding/dismissal"},
		{"checklist brought back", defaultFirstStepsWorld(firstStepsStatus(false, ``, ``)), "/api/staff-onboarding/dismissal"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			tracker := &recordingTracker{}
			serve(newFirstStepsRouter(tracker, tc.world), http.MethodPut, tc.target, `{}`, nil)
			assert.Empty(t, tracker.captured())
		})
	}
}

func TestStaffFirstStepsWithoutConsentKeepNoSession(t *testing.T) {
	t.Parallel()

	world := defaultFirstStepsWorld(firstStepsStatus(true, ``, ``))
	world.consent = false
	for _, target := range []string{"/api/staff-onboarding/steps/groups", "/api/staff-onboarding/dismissal"} {
		tracker := &recordingTracker{}
		serve(newFirstStepsRouter(tracker, world), http.MethodPut, target, `{}`, map[string]string{SessionIDHeader: testSessionID})

		events := tracker.captured()
		require.Len(t, events, 1, "the action still counts for the school: %s", target)
		assert.Empty(t, events[0].sessionID, target)
		assert.Equal(t, "school:42", events[0].distinctID, target)
	}
}

func TestStaffFirstStepsRespectTheSchoolSwitch(t *testing.T) {
	t.Parallel()

	world := defaultFirstStepsWorld(firstStepsStatus(true, `"groups"`, ``))
	world.schoolEnabled = false
	for _, target := range []string{"/api/staff-onboarding/steps/groups", "/api/staff-onboarding/dismissal?outcome=completed"} {
		tracker := &recordingTracker{}
		serve(newFirstStepsRouter(tracker, world), http.MethodPut, target, `{}`, map[string]string{SessionIDHeader: testSessionID})
		assert.Empty(t, tracker.captured(), target)
	}
}

func TestStaffFirstStepsCountNothingFromACutResponse(t *testing.T) {
	t.Parallel()

	huge := `{"status":"success","data":{"dismissed":true,"done_steps":[],"skipped_steps":[],"pad":"` +
		string(make([]byte, sessionBodyLimit)) + `"}}`
	tracker := &recordingTracker{}
	serve(newFirstStepsRouter(tracker, defaultFirstStepsWorld(huge)), http.MethodPut, "/api/staff-onboarding/dismissal", `{}`, nil)
	assert.Empty(t, tracker.captured())
}
