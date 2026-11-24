package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	settings "github.com/moto-ogs/project-phoenix/modules/settings"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// checkTraegerModuleBookingGate drives the lock of the Träger portal through
// the production router (#6052): a module none of the Träger's schools books
// answers module.not_booked on its routes, one booking school opens it for
// the Träger, the frame of the portal stays reachable and names the booked
// modules, and another Träger is not affected.
func checkTraegerModuleBookingGate(t *testing.T, api *goldenRuntime) {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)

	rights := []string{
		identityaccess.TraegerRightOverviewRead, identityaccess.TraegerRightReportsRead, identityaccess.TraegerRightEnrollmentManage,
		identityaccess.TraegerRightContractsManage, identityaccess.TraegerRightBillingManage,
	}
	office := func(name string) (int64, []int64, string) {
		organization := traegerOrganization(t, db, name, true)
		schools := []int64{
			testpkg.CreateTestSchoolInOrganization(t, db, organization, name+" OGS Nord"),
			testpkg.CreateTestSchoolInOrganization(t, db, organization, name+" OGS Süd"),
		}
		account := traegerAccount(t, db, testpkg.NewTestPassword())
		testpkg.CreateTestTraegerMember(t, db, organization, account.ID, "administration")
		token := testpkg.MintLiveSessionJWT(t, db, testpkg.TraegerTestClaims(int(account.ID), organization, []string{"administration"}, rights))
		return organization, schools, token
	}
	_, cancelled, cancelledToken := office("Modul Abbestellt")
	_, _, bookedToken := office("Modul Gebucht")

	request := func(token, path string) (int, map[string]any) {
		response := checkpointRequest(api, checkpointScenario{Method: http.MethodGet, Path: path, Authenticated: true}, token)
		var payload map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &payload)
		return response.Code, payload
	}
	setBooked := func(schoolID int64, module settings.ModuleKey, value bool) {
		definition, ok := settings.LookupModule(module)
		require.True(t, ok)
		testpkg.SetTestTenantSetting(t, db, schoolID, definition.SettingKey, fmt.Sprint(value))
	}

	// One route of every module the Träger portal carries.
	cases := []struct {
		module settings.ModuleKey
		path   string
	}{
		{settings.ModuleElternbeitraege, "/traeger/billing-runs/"},
		{settings.ModuleElternbeitraege, "/traeger/cost-bearers/"},
		{settings.ModuleVertraege, "/traeger/contracts/"},
		{settings.ModuleFerienbetreuung, "/traeger/holiday-periods/"},
		{settings.ModuleTraegerUebersicht, "/traeger/schools/alerts"},
		{settings.ModuleTraegerUebersicht, "/traeger/schools/occupancy"},
	}
	for _, school := range cancelled {
		for _, tc := range cases {
			setBooked(school, tc.module, false)
		}
	}

	for _, tc := range cases {
		status, body := request(cancelledToken, tc.path)
		require.Equalf(t, http.StatusForbidden, status, "GET %s without %s: %v", tc.path, tc.module, body)
		require.Equalf(t, common.CodeModuleNotBooked, body["code"], "GET %s: %v", tc.path, body)
		details, _ := body["details"].(map[string]any)
		require.Equalf(t, string(tc.module), details["module"], "GET %s names its module: %v", tc.path, body)
		require.NotEmptyf(t, details["module_label"], "GET %s names the module for people: %v", tc.path, body)

		status, body = request(bookedToken, tc.path)
		require.Equalf(t, http.StatusOK, status, "GET %s for the Träger whose schools book %s: %v", tc.path, tc.module, body)
	}

	bookedModules := func(t *testing.T, token string) []any {
		t.Helper()
		status, body := request(token, "/traeger/organization/")
		require.Equalf(t, http.StatusOK, status, "the frame of the portal is moto Basis: %v", body)
		data, _ := body["data"].(map[string]any)
		modules, ok := data["booked_modules"].([]any)
		require.Truef(t, ok, "the frame names the booked modules: %v", body)
		return modules
	}

	t.Run("the frame stays reachable and names the booked modules", func(t *testing.T) {
		status, body := request(cancelledToken, "/traeger/schools/")
		require.Equalf(t, http.StatusOK, status, "the school list is moto Basis: %v", body)
		modules := bookedModules(t, cancelledToken)
		for _, module := range []settings.ModuleKey{settings.ModuleElternbeitraege, settings.ModuleVertraege, settings.ModuleFerienbetreuung, settings.ModuleTraegerUebersicht} {
			require.NotContains(t, modules, string(module))
			require.Contains(t, bookedModules(t, bookedToken), string(module))
		}
	})

	t.Run("one booking school opens the module for the Träger", func(t *testing.T) {
		setBooked(cancelled[1], settings.ModuleElternbeitraege, true)
		t.Cleanup(func() { setBooked(cancelled[1], settings.ModuleElternbeitraege, false) })

		status, body := request(cancelledToken, "/traeger/billing-runs/")
		require.Equalf(t, http.StatusOK, status, "one school books Elternbeiträge: %v", body)
		require.Contains(t, bookedModules(t, cancelledToken), string(settings.ModuleElternbeitraege))
		status, body = request(cancelledToken, "/traeger/contracts/")
		require.Equalf(t, http.StatusForbidden, status, "Verträge stays cancelled at both schools: %v", body)
	})
}
