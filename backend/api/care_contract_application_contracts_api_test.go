// Router-level tests for the contracts of an application as the school
// reads them (#4788, ADR 0088 section 7): the school sees, in its own tenant
// transaction, the status and the booked care of the contracts the Träger
// made from its application children, never a draft and never a contract of
// another school, and only behind the right of the enrollment detail.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	careContractHTTP "github.com/moto-ogs/project-phoenix/modules/carecontract/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type applicationContractsFixture struct {
	db     *bun.DB
	router http.Handler
	school int64
	other  int64
	// sent, draft, concluded are request children at the school; foreign is
	// one at the other school of the same Träger.
	sent, draft, concluded, foreign int64
}

func newApplicationContractsFixture(t *testing.T, name string) applicationContractsFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: name, Slug: fmt.Sprintf("traeger-anmeldevertrag-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	testpkg.OwnTraegerCareContracts(t, db, organization)
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Anmeldung")
	other := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Nachbar")
	august := calendar.NewDate(2099, 8, 3)
	requestChild := func(contract int64) int64 {
		var id int64
		require.NoError(t, db.NewRaw(`SELECT request_child_id FROM care_contract.contracts WHERE id = ?`, contract).
			Scan(t.Context(), &id))
		return id
	}
	sent := testpkg.CreateTestCareContract(t, db, organization, school, testpkg.UniqueTestTenantID(t), carecontract.StatusSent, august,
		testpkg.CareContractService{Weekday: "mon", Module: "Früh", EndsAt: "08:00"},
		testpkg.CareContractService{Weekday: "mon", Module: "Ganztag", EndsAt: "16:00"})
	draft := testpkg.CreateTestCareContract(t, db, organization, school, testpkg.UniqueTestTenantID(t), carecontract.StatusDraft, august,
		testpkg.CareContractService{Weekday: "tue", Module: "Ganztag", EndsAt: "16:00"})
	concluded := testpkg.CreateTestCareContract(t, db, organization, school, testpkg.UniqueTestTenantID(t), carecontract.StatusSent, august,
		testpkg.CareContractService{Weekday: "wed", Module: "Kurz", EndsAt: "14:00"})
	_, err := db.ExecContext(t.Context(), `UPDATE care_contract.contracts SET status = ?, concluded_at = ?, conclusion_method = ?
		WHERE id = ?`, carecontract.StatusActive, time.Date(2099, 7, 1, 9, 30, 0, 0, time.UTC), carecontract.MethodWithApplication, concluded)
	require.NoError(t, err)
	foreign := testpkg.CreateTestCareContract(t, db, organization, other, testpkg.UniqueTestTenantID(t), carecontract.StatusSent, august,
		testpkg.CareContractService{Weekday: "thu", Module: "Ganztag", EndsAt: "16:00"})

	resource := careContractHTTP.NewApplicationContractResource(careContractCompose.NewApplicationContracts(),
		common.RequiresPermission(permissions.ConfigManage))
	unit := testpkg.TenantRuntime(t, db)
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(tenant.WithUnitOfWork(r.Context(), unit)))
		})
	})
	router.Mount("/api/care-contracts", resource.Router(ProtectedTenantRoutes))
	return applicationContractsFixture{db: db, router: testpkg.SessionVerifier(router), school: school, other: other,
		sent: requestChild(sent), draft: requestChild(draft), concluded: requestChild(concluded), foreign: requestChild(foreign)}
}

func (f applicationContractsFixture) staffOf(t *testing.T, schoolID int64, perms ...string) string {
	t.Helper()
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, schoolID, "Paula", "Anmeldung")
	return testpkg.MintTestJWT(t, sessiontoken.AppClaims{
		ID: int(account.ID), Sub: account.Email, Username: "anmeldung", FirstName: "Paula", LastName: "Anmeldung",
		Roles: []string{"admin"}, TenantID: schoolID, Permissions: perms,
	})
}

func (f applicationContractsFixture) path(ids ...int64) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = fmt.Sprint(id)
	}
	return "/api/care-contracts/?request_child_ids=" + strings.Join(parts, ",")
}

func (f applicationContractsFixture) get(t *testing.T, token, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	return rec
}

type applicationContractBody struct {
	RequestChildID string  `json:"request_child_id"`
	ContractID     string  `json:"contract_id"`
	Status         string  `json:"status"`
	SentAt         *string `json:"sent_at"`
	Concluded      *struct {
		Method string `json:"method"`
		At     string `json:"at"`
	} `json:"concluded"`
	EffectiveFrom *string `json:"effective_from"`
	Services      []struct {
		Weekday    string `json:"weekday"`
		ModuleName string `json:"module_name"`
		EndsAt     string `json:"ends_at"`
	} `json:"services"`
}

func decodeApplicationContracts(t *testing.T, body []byte) []applicationContractBody {
	t.Helper()
	var envelope struct {
		Data []applicationContractBody `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &envelope), string(body))
	return envelope.Data
}

func TestApplicationContractsShowTheSchoolItsSentAndConcludedContracts(t *testing.T) {
	t.Parallel()
	f := newApplicationContractsFixture(t, "Träger Anmeldevertrag")
	token := f.staffOf(t, f.school, permissions.ConfigManage)

	rec := f.get(t, token, f.path(f.sent, f.draft, f.concluded, f.foreign))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	contracts := decodeApplicationContracts(t, rec.Body.Bytes())
	byChild := map[string]applicationContractBody{}
	for _, contract := range contracts {
		byChild[contract.RequestChildID] = contract
	}
	require.Len(t, contracts, 2, "neither the draft nor the other school's contract reaches the school")
	assert.NotContains(t, byChild, fmt.Sprint(f.draft), "a draft promises nothing yet")
	assert.NotContains(t, byChild, fmt.Sprint(f.foreign), "a contract of another school stays there")

	sent := byChild[fmt.Sprint(f.sent)]
	assert.Equal(t, carecontract.StatusSent, sent.Status)
	assert.NotNil(t, sent.SentAt)
	assert.Nil(t, sent.Concluded, "a sent contract is not concluded yet")
	require.NotNil(t, sent.EffectiveFrom)
	assert.Equal(t, "2099-08-03", *sent.EffectiveFrom)
	require.Len(t, sent.Services, 2)
	assert.Equal(t, "mon", sent.Services[0].Weekday)
	assert.Equal(t, "Früh", sent.Services[0].ModuleName)
	assert.Equal(t, "08:00", sent.Services[0].EndsAt)
	assert.Equal(t, "16:00", sent.Services[1].EndsAt)

	concluded := byChild[fmt.Sprint(f.concluded)]
	assert.Equal(t, carecontract.StatusActive, concluded.Status)
	require.NotNil(t, concluded.Concluded)
	assert.Equal(t, carecontract.MethodWithApplication, concluded.Concluded.Method)
	at, err := time.Parse(time.RFC3339, concluded.Concluded.At)
	require.NoError(t, err)
	assert.True(t, at.Equal(time.Date(2099, 7, 1, 9, 30, 0, 0, time.UTC)), concluded.Concluded.At)

	// The other school asks for the same children and sees only its own.
	rec = f.get(t, f.staffOf(t, f.other, permissions.ConfigManage), f.path(f.sent, f.concluded, f.foreign))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	others := decodeApplicationContracts(t, rec.Body.Bytes())
	require.Len(t, others, 1)
	assert.Equal(t, fmt.Sprint(f.foreign), others[0].RequestChildID)
}

func TestApplicationContractsNeedTheRightOfTheEnrollmentDetail(t *testing.T) {
	t.Parallel()
	f := newApplicationContractsFixture(t, "Träger Anmeldevertrag Recht")
	rec := f.get(t, f.staffOf(t, f.school, permissions.ConfigRead), f.path(f.sent))
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
}

func TestApplicationContractsRefuseAMissingOrMalformedChildList(t *testing.T) {
	t.Parallel()
	f := newApplicationContractsFixture(t, "Träger Anmeldevertrag Liste")
	token := f.staffOf(t, f.school, permissions.ConfigManage)
	tooMany := make([]int64, carecontract.MaxApplicationChildren+1)
	for i := range tooMany {
		tooMany[i] = int64(i + 1)
	}
	for _, path := range []string{"/api/care-contracts/", "/api/care-contracts/?request_child_ids=1,x",
		"/api/care-contracts/?request_child_ids=0", f.path(tooMany...)} {
		rec := f.get(t, token, path)
		assert.Equal(t, http.StatusBadRequest, rec.Code, path)
		assert.Contains(t, rec.Body.String(), `"code"`, path)
	}
}

func TestApplicationContractsQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	f := newApplicationContractsFixture(t, "Träger Anmeldevertrag Budget")
	token := f.staffOf(t, f.school, permissions.ConfigManage)
	read := func(ids ...int64) testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		req := httptest.NewRequest(http.MethodGet, f.path(ids...), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, f.router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	one := read(f.sent)
	assert.Len(t, read(f.sent, f.draft, f.concluded, f.foreign).Statements, len(one.Statements),
		"the read is one statement for any number of children")
	querybudgets.AssertQueryBudget(t, "api.care_contracts.application_contracts", one)
}
