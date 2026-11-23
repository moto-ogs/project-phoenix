//go:build testhooks

package absencetypes_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The Leitung sets and reads a staff member's yearly Kontingent through the
// routes under their production path; the staff portal reaches them through
// its catalog proxy since #7563. A read without a year is refused. The clock
// stands in 2026: in a later year the 2026 Kontingent is past and its
// remaining days count as 0 (Clock early warning, 2027-01-01).
func TestAbsenceTypeAllowanceIsSetAndReadThroughTheRoutes(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	now := func() time.Time { return time.Date(2026, time.September, 9, 12, 0, 0, 0, calendar.Berlin) }
	module, caller, err := api.NewAbsenceTypeTestModule(testpkg.NewDatabase(t, db), now)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Mount("/api/absence-types", api.NewAbsenceTypesRouterForBudgetTest(module.Administration, caller.Caller().StaffID))
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Kontingent", fmt.Sprintf("Leitung-%d", testpkg.UniqueSuffix()))
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	staff := testpkg.CreateTestStaff(t, db, "Kontingent", fmt.Sprintf("Kraft-%d", testpkg.UniqueSuffix()))
	claims := testutil.DefaultTestClaims()
	claims.TenantID = testpkg.Tenant(t)
	claims.ID = int(account.ID)
	claims.IsAdmin = false
	claims.Permissions = []string{"time_tracking:manage"}
	auth := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	send := func(method, path string, body any, status int) []byte {
		t.Helper()
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, path, body, auth))
		require.Equal(t, status, response.Code, response.Body.String())
		return response.Body.Bytes()
	}
	type summary struct {
		StaffID       string  `json:"staff_id"`
		AbsenceTypeID string  `json:"absence_type_id"`
		Year          int     `json:"year"`
		EntitledDays  float64 `json:"entitled_days"`
		RemainingDays float64 `json:"remaining_days"`
	}
	decode := func(raw []byte) summary {
		t.Helper()
		var envelope struct {
			Data summary `json:"data"`
		}
		require.NoError(t, json.Unmarshal(raw, &envelope))
		return envelope.Data
	}

	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(send(http.MethodPost, "/api/absence-types/", map[string]any{"name": "Bildungsurlaub"}, http.StatusCreated), &created))
	send(http.MethodPut, "/api/absence-types/"+created.Data.ID, map[string]any{"allowance_enabled": true}, http.StatusOK)
	path := fmt.Sprintf("/api/absence-types/%s/allowances/%d", created.Data.ID, staff.ID)

	readVersion := func() string {
		t.Helper()
		var envelope struct {
			Data struct {
				Version string `json:"version"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(send(http.MethodGet, path+"?year=2026", nil, http.StatusOK), &envelope))
		return envelope.Data.Version
	}
	read := readVersion()
	saved := decode(send(http.MethodPut, path, map[string]any{"year": 2026, "entitled_days": 5, "reason": "Vertrag", "expected_version": read}, http.StatusOK))
	// A second save from the same read is refused: the claim changed since
	// (ADR 0311).
	stale := send(http.MethodPut, path, map[string]any{"year": 2026, "entitled_days": 6, "reason": "Vertrag", "expected_version": read}, http.StatusConflict)
	assert.Contains(t, string(stale), "general.changed_since_read")
	want := summary{StaffID: fmt.Sprint(staff.ID), AbsenceTypeID: created.Data.ID, Year: 2026, EntitledDays: 5, RemainingDays: 5}
	assert.Equal(t, want, saved)
	assert.Equal(t, want, decode(send(http.MethodGet, path+"?year=2026", nil, http.StatusOK)))

	send(http.MethodGet, path, nil, http.StatusBadRequest)
}
