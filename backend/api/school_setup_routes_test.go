package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/analytics"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/schoolsetup"
	schoolSetupHTTP "github.com/moto-ogs/project-phoenix/modules/schoolsetup/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type fixedSchoolSetupSettings struct{}

func (fixedSchoolSetupSettings) PresenceMode(context.Context) (string, error) { return "detailed", nil }
func (fixedSchoolSetupSettings) GroupMode(context.Context) (string, error)    { return "fixed", nil }

// setupEventTracker records the setup checklist's core actions (#7554).
type setupEventTracker struct {
	mu     sync.Mutex
	events []string
}

func (s *setupEventTracker) Capture(distinctID, event string, props map[string]any) {
	s.CaptureContext(context.Background(), distinctID, event, props)
}

func (s *setupEventTracker) CaptureContext(_ context.Context, _, event string, props map[string]any) {
	if !strings.HasPrefix(event, "onboarding_setup_checklist_") {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if step, ok := props["step"]; ok {
		event += ":" + step.(string)
	}
	s.events = append(s.events, event)
}

func (*setupEventTracker) Close() error { return nil }

// An administrator skips every open step of the wizard, completes it and
// hides it; a care worker finishes and skips steps of their first steps and
// hides them. Every write answers the fresh state.
func TestSchoolSetupRoutesAnswerTheFreshState(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	wizard, err := NewSchoolSetupTestService(fixedSchoolSetupSettings{}, func(context.Context) (schoolsetup.WorkTimeTargets, error) {
		return schoolsetup.WorkTimeTargets{}, nil
	})
	require.NoError(t, err)
	firstSteps, err := NewStaffOnboardingTestService()
	require.NoError(t, err)
	tracker := &setupEventTracker{}
	router := chi.NewRouter()
	// The real wire shape reaches the core actions: one event per skipped
	// step with its key, completion and dismissal.
	router.Use(analytics.CoreActionMiddleware(analytics.CoreActionConfig{
		Tracker: tracker,
		Policy:  analytics.CollectionPolicy{SchoolEnabled: func(context.Context, int64) (bool, error) { return true, nil }},
		RequestActor: func(*http.Request) (analytics.Actor, bool) {
			return analytics.Actor{Surface: analytics.SurfaceOGS, Role: analytics.RoleAdmin, SchoolID: 1, AccountID: 1}, true
		},
	}))
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/school-setup", schoolSetupHTTP.NewResource(wizard, schoolSetupRuntime()).Router())
	router.Mount("/api/staff-onboarding", schoolSetupHTTP.NewStaffResource(firstSteps, schoolSetupRuntime()).Router())
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Einrichtung", "Leitung")
	claims := testutil.TenantUserTestClaims(int(account.ID), testpkg.Tenant(t), "admin:*")
	bearer := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	send := func(method, path string, body, out any) {
		t.Helper()
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, path, body, bearer))
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &struct{ Data any }{Data: out}))
	}

	var wizardState schoolsetup.Status
	send(http.MethodGet, "/api/school-setup/", nil, &wizardState)
	require.NotEmpty(t, wizardState.Steps)
	var wantEvents []string
	for _, step := range wizardState.Steps {
		if step.Applies && !step.Done && !step.Skipped {
			wantEvents = append(wantEvents, "onboarding_setup_checklist_step_skipped:"+step.Key)
			send(http.MethodPut, "/api/school-setup/steps/"+step.Key, map[string]any{"skipped": true}, &wizardState)
		}
	}
	for _, step := range wizardState.Steps {
		assert.True(t, !step.Applies || step.Done || step.Skipped, "step %s is still open", step.Key)
	}
	send(http.MethodPost, "/api/school-setup/complete", nil, &wizardState)
	assert.True(t, wizardState.Completed)
	send(http.MethodPut, "/api/school-setup/dismissal", map[string]any{"dismissed": true}, &wizardState)
	assert.True(t, wizardState.Dismissed)
	wantEvents = append(wantEvents, "onboarding_setup_checklist_completed", "onboarding_setup_checklist_dismissed")
	assert.Equal(t, wantEvents, tracker.events)

	var staffState schoolsetup.StaffStatus
	send(http.MethodGet, "/api/staff-onboarding/", nil, &staffState)
	assert.NotContains(t, staffState.DoneSteps, string(schoolsetup.StaffStepGroups))
	send(http.MethodPut, "/api/staff-onboarding/steps/"+string(schoolsetup.StaffStepGroups), map[string]any{"state": schoolsetup.StaffStepStateDone}, &staffState)
	assert.Contains(t, staffState.DoneSteps, string(schoolsetup.StaffStepGroups))
	send(http.MethodPut, "/api/staff-onboarding/steps/"+string(schoolsetup.StaffStepCalendar), map[string]any{"state": schoolsetup.StaffStepStateSkipped}, &staffState)
	assert.Contains(t, staffState.SkippedSteps, string(schoolsetup.StaffStepCalendar))
	send(http.MethodPut, "/api/staff-onboarding/dismissal", map[string]any{"dismissed": true}, &staffState)
	assert.True(t, staffState.Dismissed)
}
