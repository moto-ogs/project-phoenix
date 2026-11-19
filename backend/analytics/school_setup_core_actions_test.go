package analytics

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The setup checklist of the school's leadership (#7554): complete, skip a
// step and dismiss are core actions. The routes answer the wizard's state,
// the way modules/schoolsetup/http does.
type schoolSetupRouterOptions struct {
	schoolEnabled bool
	consent       bool
}

var schoolSetupAdmin = Actor{Surface: SurfaceOGS, Role: RoleAdmin, SchoolID: 42, AccountID: 7}

func newSchoolSetupRouter(tracker Tracker, opts schoolSetupRouterOptions) http.Handler {
	failed := func(r *http.Request) bool { return r.URL.Query().Get("status") == "409" }
	answer := func(w http.ResponseWriter, r *http.Request, body string) {
		w.Header().Set("Content-Type", "application/json")
		if failed(r) {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"status":409,"code":"school.setup_completed"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","data":` + body + `}`))
	}
	root := chi.NewRouter()
	root.Use(CoreActionMiddleware(CoreActionConfig{
		Policy: CollectionPolicy{
			SchoolEnabled: func(context.Context, int64) (bool, error) { return opts.schoolEnabled, nil },
		},
		Tracker:      tracker,
		RequestActor: func(*http.Request) (Actor, bool) { return schoolSetupAdmin, true },
		Consent:      func(context.Context, int64) bool { return opts.consent },
	}))
	root.Route("/api/school-setup", func(r chi.Router) {
		r.Put("/steps/{step}", func(w http.ResponseWriter, r *http.Request) {
			skipped := r.URL.Query().Get("skipped") != "false"
			answer(w, r, `{"completed":false,"dismissed":false,"steps":[`+
				`{"key":"team","applies":true,"done":true,"skipped":false},`+
				`{"key":"rooms","applies":true,"done":false,"skipped":`+strconv.FormatBool(skipped)+`}]}`)
		})
		r.Post("/complete", func(w http.ResponseWriter, r *http.Request) {
			answer(w, r, `{"completed":true,"dismissed":false,"steps":[]}`)
		})
		r.Put("/dismissal", func(w http.ResponseWriter, r *http.Request) {
			dismissed := r.URL.Query().Get("dismissed") != "false"
			answer(w, r, `{"completed":false,"dismissed":`+strconv.FormatBool(dismissed)+`,"steps":[]}`)
		})
	})
	return root
}

var schoolSetupRequests = []struct {
	method, path, event string
	props               map[string]any
}{
	{http.MethodPost, "/api/school-setup/complete", "onboarding_setup_checklist_completed", nil},
	{http.MethodPut, "/api/school-setup/steps/rooms", "onboarding_setup_checklist_step_skipped", map[string]any{"step": "rooms"}},
	{http.MethodPut, "/api/school-setup/dismissal", "onboarding_setup_checklist_dismissed", nil},
}

func TestSchoolSetupCoreActionsSendOneEventOnSuccess(t *testing.T) {
	t.Parallel()

	for _, request := range schoolSetupRequests {
		t.Run(request.event, func(t *testing.T) {
			t.Parallel()
			tracker := &recordingTracker{}
			router := newSchoolSetupRouter(tracker, schoolSetupRouterOptions{schoolEnabled: true, consent: true})

			rec := serve(router, request.method, request.path, `{"skipped":true,"dismissed":true}`, map[string]string{SessionIDHeader: testSessionID})
			require.Equal(t, http.StatusOK, rec.Code)

			events := tracker.captured()
			require.Len(t, events, 1)
			assert.Equal(t, request.event, events[0].event)
			assert.Equal(t, "school:42", events[0].distinctID)
			assert.Equal(t, testSessionID, events[0].sessionID)
			want := map[string]any{"surface": SurfaceOGS, "role": RoleAdmin, "school_id": "42"}
			for key, value := range request.props {
				want[key] = value
			}
			assert.Equal(t, want, events[0].props, "only fixed values: the step key from the server's list")
		})
	}
}

func TestSchoolSetupCoreActionsSendNothingOnFailure(t *testing.T) {
	t.Parallel()

	tracker := &recordingTracker{}
	router := newSchoolSetupRouter(tracker, schoolSetupRouterOptions{schoolEnabled: true, consent: true})
	for _, request := range schoolSetupRequests {
		rec := serve(router, request.method, request.path+"?status=409", `{}`, nil)
		require.Equal(t, http.StatusConflict, rec.Code)
	}
	assert.Empty(t, tracker.captured())
}

func TestSchoolSetupCoreActionsWithoutConsentHaveNoSession(t *testing.T) {
	t.Parallel()

	tracker := &recordingTracker{}
	router := newSchoolSetupRouter(tracker, schoolSetupRouterOptions{schoolEnabled: true, consent: false})
	for _, request := range schoolSetupRequests {
		serve(router, request.method, request.path, `{}`, map[string]string{SessionIDHeader: testSessionID})
	}

	events := tracker.captured()
	require.Len(t, events, len(schoolSetupRequests), "without consent the event still counts for the school")
	for _, event := range events {
		assert.Empty(t, event.sessionID, event.event)
		assert.Equal(t, "school:42", event.distinctID, event.event)
	}
}

func TestSchoolSetupCoreActionsRespectTheSchoolSwitch(t *testing.T) {
	t.Parallel()

	tracker := &recordingTracker{}
	router := newSchoolSetupRouter(tracker, schoolSetupRouterOptions{schoolEnabled: false, consent: true})
	for _, request := range schoolSetupRequests {
		serve(router, request.method, request.path, `{}`, map[string]string{SessionIDHeader: testSessionID})
	}
	assert.Empty(t, tracker.captured())
}

// Taking a skip or a dismissal back is no core action, and a step the
// response does not list never reaches the event.
func TestSchoolSetupCoreActionsCountOnlyTheNamedDirection(t *testing.T) {
	t.Parallel()

	tracker := &recordingTracker{}
	router := newSchoolSetupRouter(tracker, schoolSetupRouterOptions{schoolEnabled: true, consent: true})
	serve(router, http.MethodPut, "/api/school-setup/steps/rooms?skipped=false", `{"skipped":false}`, nil)
	serve(router, http.MethodPut, "/api/school-setup/steps/team", `{"skipped":true}`, nil)
	serve(router, http.MethodPut, "/api/school-setup/steps/Mia%20M%C3%BCller", `{"skipped":true}`, nil)
	serve(router, http.MethodPut, "/api/school-setup/dismissal?dismissed=false", `{"dismissed":false}`, nil)

	assert.Empty(t, tracker.captured())
}
