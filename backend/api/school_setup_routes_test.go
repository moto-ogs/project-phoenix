package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/schoolsetup"
	schoolSetupHTTP "github.com/moto-ogs/project-phoenix/modules/schoolsetup/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type fixedSchoolSetupSettings struct{}

func (fixedSchoolSetupSettings) PresenceMode(context.Context) (string, error) { return "detailed", nil }
func (fixedSchoolSetupSettings) GroupMode(context.Context) (string, error)    { return "fixed", nil }

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
	router := chi.NewRouter()
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
	for _, step := range wizardState.Steps {
		if step.Applies && !step.Done && !step.Skipped {
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
