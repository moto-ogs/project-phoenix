// Router-level tests for the responsibilities at the schools of a Träger
// (#4811): who concludes contracts, bills and employs is a setting with a
// Träger value and a school override; the Träger-Büro keeps the Schulträger
// and the Gemeinde of each school; a body without stored master data leaves
// the Träger responsible; no Träger reaches the schools of another; every
// change is logged.
package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

const responsibilitiesPath = "/traeger/master-data/responsibilities"

type schoolPartyBody struct {
	Kind          string `json:"kind,omitempty"`
	Name          string `json:"name"`
	Street        string `json:"street"`
	PostalCode    string `json:"postal_code"`
	City          string `json:"city"`
	ContactName   string `json:"contact_name"`
	ContactPhone  string `json:"contact_phone"`
	ContactEmail  string `json:"contact_email"`
	CreditorID    string `json:"creditor_id"`
	AccountHolder string `json:"account_holder"`
	IBAN          string `json:"iban"`
	BIC           string `json:"bic"`
	BankName      string `json:"bank_name"`
	Version       string `json:"version,omitempty"`
	// ExpectedVersion is the version a save was read with (ADR 0311).
	ExpectedVersion string `json:"expected_version,omitempty"`
}

type areaResponsibilityBody struct {
	Area      string `json:"area"`
	Body      string `json:"body"`
	Source    string `json:"source"`
	Effective string `json:"effective"`
}

type schoolResponsibilityBody struct {
	SchoolID   wireID                   `json:"school_id"`
	SchoolName string                   `json:"school_name"`
	Areas      []areaResponsibilityBody `json:"areas"`
	Parties    []schoolPartyBody        `json:"parties"`
}

type responsibilityOverviewBody struct {
	Schools []schoolResponsibilityBody `json:"schools"`
}

// newResponsibilityPortal is the Träger portal on the package database.
func newResponsibilityPortal(t *testing.T) (*bun.DB, *traegerPortalHandler) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	portal, _ := traegerPortalOn(t, db, testpkg.TenantRuntime(t, db))
	return db, portal
}

func schoolPartyPath(schoolID int64, kind string) string {
	return responsibilitiesPath + "/schools/" + strconv.FormatInt(schoolID, 10) + "/parties/" + kind
}

func responsibilityOverview(t *testing.T, router http.Handler, token string) responsibilityOverviewBody {
	t.Helper()
	rec := traegerJSON(t, router, token, http.MethodGet, responsibilitiesPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[responsibilityOverviewBody](t, rec.Body.Bytes())
}

func responsibilityOf(t *testing.T, overview responsibilityOverviewBody, schoolID int64) schoolResponsibilityBody {
	t.Helper()
	for _, school := range overview.Schools {
		if int64(school.SchoolID) == schoolID {
			return school
		}
	}
	require.Failf(t, "school missing", "school %d is not in the overview", schoolID)
	return schoolResponsibilityBody{}
}

func saveSchoolParty(t *testing.T, router http.Handler, token string, schoolID int64, kind string, body schoolPartyBody) schoolPartyBody {
	t.Helper()
	rec := traegerJSON(t, router, token, http.MethodPut, schoolPartyPath(schoolID, kind), body)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[schoolPartyBody](t, rec.Body.Bytes())
}

// setTraegerResponsibility sets the Träger value of a responsibility
// through the Träger settings route.
func setTraegerResponsibility(t *testing.T, router http.Handler, token, key, body string) {
	t.Helper()
	rec := traegerJSON(t, router, token, http.MethodPut, "/traeger/settings/values/"+key, map[string]any{"value": body})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

// setSchoolResponsibility stores the school's own value of a
// responsibility, as the school's settings page does.
func setSchoolResponsibility(t *testing.T, db *bun.DB, schoolID int64, key, body string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, ?, to_jsonb(?::text))`, schoolID, key, body)
	require.NoError(t, err)
}

var gemeindeHardt = schoolPartyBody{
	Name: "  Gemeinde Hardt ", Street: "Rathausplatz 1", PostalCode: "41749", City: "Viersen",
	ContactName: "Petra Sommer", ContactPhone: "02162 1010", ContactEmail: "Kasse@Hardt.example",
	CreditorID: "de98 zzz0 9999 9999 99", AccountHolder: "Gemeinde Hardt", IBAN: "de02 1203 0000 0000 2020 51", BIC: "byladem1001", BankName: "Deutsche Kreditbank",
}

func TestTraegerResponsibilitiesFollowTheSettingsAndTheStoredBodies(t *testing.T) {
	t.Parallel()
	db, router := newResponsibilityPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Zuständigkeiten", identityaccess.TraegerRoleAdministration)
	north, south := office.schools[0], office.schools[1]

	// Without a value the Träger is responsible for all three.
	for _, school := range responsibilityOverview(t, router, office.token).Schools {
		require.Len(t, school.Areas, 3)
		for i, area := range []string{"contracts", "billing", "staff"} {
			assert.Equal(t, areaResponsibilityBody{Area: area, Body: "traeger", Source: "default", Effective: "traeger"}, school.Areas[i])
		}
		assert.Empty(t, school.Parties)
	}

	// The Träger names the Gemeinde for contracts and billing of all its
	// schools; without stored master data the Träger stays responsible.
	setTraegerResponsibility(t, router, office.token, "responsibility.contracts", "gemeinde")
	setTraegerResponsibility(t, router, office.token, "responsibility.billing", "gemeinde")
	named := responsibilityOf(t, responsibilityOverview(t, router, office.token), north)
	assert.Equal(t, areaResponsibilityBody{Area: "contracts", Body: "gemeinde", Source: "traeger", Effective: "traeger"}, named.Areas[0],
		"a Gemeinde without master data cannot stand on a contract")

	// The Träger-Büro stores the Gemeinde of the northern school, first
	// without what billing needs.
	bare := gemeindeHardt
	bare.CreditorID, bare.AccountHolder, bare.IBAN, bare.BIC, bare.BankName = "", "", "", "", ""
	stored := saveSchoolParty(t, router, office.token, north, "gemeinde", bare)
	assert.Equal(t, "gemeinde", stored.Kind)
	assert.Equal(t, "Gemeinde Hardt", stored.Name, "the name is trimmed")
	assert.Equal(t, "kasse@hardt.example", stored.ContactEmail, "the e-mail is stored in lower case")
	require.NotEmpty(t, stored.Version)
	withAddress := responsibilityOf(t, responsibilityOverview(t, router, office.token), north)
	assert.Equal(t, "gemeinde", withAddress.Areas[0].Effective, "name and address are enough for contracts")
	assert.Equal(t, areaResponsibilityBody{Area: "billing", Body: "gemeinde", Source: "traeger", Effective: "traeger"}, withAddress.Areas[1],
		"billing needs the creditor identifier and a bank account")
	assert.Equal(t, "traeger", responsibilityOf(t, responsibilityOverview(t, router, office.token), south).Areas[0].Effective,
		"the body of one school is not the body of another")

	// A save without the version it was read with is refused; with it the
	// creditor identifier and the bank account make billing effective.
	full := gemeindeHardt
	stale := traegerJSON(t, router, office.token, http.MethodPut, schoolPartyPath(north, "gemeinde"), full)
	require.Equal(t, http.StatusConflict, stale.Code, stale.Body.String())
	assert.Equal(t, readstate.ChangedCode, refusalOf(t, stale).Code)
	full.ExpectedVersion = stored.Version
	saved := saveSchoolParty(t, router, office.token, north, "gemeinde", full)
	assert.Equal(t, "DE98ZZZ09999999999", saved.CreditorID, "the creditor identifier is compacted")
	assert.Equal(t, "DE02120300000000202051", saved.IBAN)
	assert.Equal(t, "BYLADEM1001", saved.BIC)
	assert.Equal(t, "gemeinde", responsibilityOf(t, responsibilityOverview(t, router, office.token), north).Areas[1].Effective)

	// The southern school takes its own value: the school override wins
	// over the Träger value.
	setSchoolResponsibility(t, db, south, "responsibility.contracts", "schultraeger")
	saveSchoolParty(t, router, office.token, south, "schultraeger", schoolPartyBody{Name: "Stadt Viersen", Street: "Bahnhofstraße 23", PostalCode: "41747", City: "Viersen"})
	own := responsibilityOf(t, responsibilityOverview(t, router, office.token), south)
	assert.Equal(t, areaResponsibilityBody{Area: "contracts", Body: "schultraeger", Source: "school", Effective: "schultraeger"}, own.Areas[0])
	assert.Equal(t, areaResponsibilityBody{Area: "staff", Body: "traeger", Source: "default", Effective: "traeger"}, own.Areas[2])

	// Removing the Gemeinde hands the northern school back to the Träger.
	require.Equal(t, http.StatusNoContent, traegerJSON(t, router, office.token, http.MethodDelete, schoolPartyPath(north, "gemeinde"), nil).Code)
	removed := responsibilityOf(t, responsibilityOverview(t, router, office.token), north)
	assert.Equal(t, areaResponsibilityBody{Area: "contracts", Body: "gemeinde", Source: "traeger", Effective: "traeger"}, removed.Areas[0])
	assert.Empty(t, removed.Parties)
	gone := traegerJSON(t, router, office.token, http.MethodDelete, schoolPartyPath(north, "gemeinde"), nil)
	assert.Equal(t, http.StatusNotFound, gone.Code, gone.Body.String())

	var logged []string
	require.NoError(t, db.NewRaw(`SELECT action FROM platform.traeger_master_data_audit
		WHERE organization_id = ? AND subject = 'school_party' AND action <> 'read' ORDER BY id`, office.organization).Scan(context.Background(), &logged))
	assert.Equal(t, []string{"create", "update", "create", "delete"}, logged, "every change stands in the master data log; refusals write nothing")
	var settingChanges int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM config.traeger_setting_audit
		WHERE organization_id = ? AND setting_key LIKE 'responsibility.%'`, office.organization).Scan(context.Background(), &settingChanges))
	assert.Equal(t, 2, settingChanges, "every change of a Träger value stands in the settings audit")
}

func TestTraegerSchoolPartiesRefuseWhatNoLetterCanPrint(t *testing.T) {
	t.Parallel()
	db, router := newResponsibilityPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Stellen Prüfung", identityaccess.TraegerRoleAdministration)
	foreign := newMasterDataOffice(t, db, router, "Träger Stellen Fremd", identityaccess.TraegerRoleAdministration)
	school := office.schools[0]
	valid := schoolPartyBody{Name: "Gemeinde Hardt", Street: "Rathausplatz 1", PostalCode: "41749", City: "Viersen"}

	for name, test := range map[string]struct {
		change func(*schoolPartyBody)
		fields []string
	}{
		"name and address are required": {func(b *schoolPartyBody) { b.Name, b.Street, b.City = " ", "", "" }, []string{"city", "name", "street"}},
		"a postal code has five digits": {func(b *schoolPartyBody) { b.PostalCode = "4174" }, []string{"postal_code"}},
		"the contact is checked":        {func(b *schoolPartyBody) { b.ContactPhone, b.ContactEmail = "anrufen", "kasse" }, []string{"contact_email", "contact_phone"}},
		"the creditor identifier":       {func(b *schoolPartyBody) { b.CreditorID = "12345" }, []string{"creditor_id"}},
		"an IBAN is checked":            {func(b *schoolPartyBody) { b.IBAN, b.AccountHolder = "DE00123", "Gemeinde Hardt" }, []string{"iban"}},
		"an account names its holder":   {func(b *schoolPartyBody) { b.IBAN = "DE02120300000000202051" }, []string{"account_holder"}},
		"a holder needs an account":     {func(b *schoolPartyBody) { b.AccountHolder = "Gemeinde Hardt" }, []string{"iban"}},
	} {
		body := valid
		test.change(&body)
		rec := traegerJSON(t, router, office.token, http.MethodPut, schoolPartyPath(school, "gemeinde"), body)
		require.Equal(t, http.StatusBadRequest, rec.Code, "%s: %s", name, rec.Body.String())
		assert.Equal(t, "traeger.master_data_invalid", refusalOf(t, rec).Code, name)
		assert.ElementsMatch(t, test.fields, refusedFields(t, rec), name)
	}

	// The Träger has its own master data, and a school of another Träger
	// is no school of this one: 404, nothing is stored.
	for name, rec := range map[string]*httptest.ResponseRecorder{
		"the Träger keeps no school master data": traegerJSON(t, router, office.token, http.MethodPut, schoolPartyPath(school, "traeger"), valid),
		"an unknown body":                        traegerJSON(t, router, office.token, http.MethodPut, schoolPartyPath(school, "kirche"), valid),
		"a school of another Träger":             traegerJSON(t, router, office.token, http.MethodPut, schoolPartyPath(foreign.schools[0], "gemeinde"), valid),
		"removing at another Träger's school":    traegerJSON(t, router, office.token, http.MethodDelete, schoolPartyPath(foreign.schools[0], "gemeinde"), nil),
	} {
		assert.Equal(t, http.StatusNotFound, rec.Code, "%s: %s", name, rec.Body.String())
	}
	saveSchoolParty(t, router, foreign.token, foreign.schools[0], "gemeinde", schoolPartyBody{Name: "Gemeinde Fremd", Street: "Markt 2", PostalCode: "47798", City: "Krefeld"})
	own := responsibilityOverview(t, router, office.token)
	for _, entry := range own.Schools {
		assert.NotContains(t, foreign.schools, int64(entry.SchoolID), "no Träger lists the schools of another")
		assert.Empty(t, entry.Parties, "refusals stored nothing, and no body of another Träger shows")
	}
	var rows int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM platform.school_responsible_parties WHERE organization_id = ?`, office.organization).Scan(context.Background(), &rows))
	assert.Zero(t, rows)
}

func TestTraegerResponsibilitiesNeedTheirRights(t *testing.T) {
	t.Parallel()
	db, router := newResponsibilityPortal(t)
	admin := newMasterDataOffice(t, db, router, "Träger Zuständigkeiten Rechte", identityaccess.TraegerRoleAdministration)
	school := admin.schools[0]
	body := schoolPartyBody{Name: "Gemeinde Hardt", Street: "Rathausplatz 1", PostalCode: "41749", City: "Viersen"}
	saveSchoolParty(t, router, admin.token, school, "gemeinde", body)

	password := testpkg.NewTestPassword()
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, admin.organization, account.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	readOnly := answer.AccessToken

	assert.Len(t, responsibilityOverview(t, router, readOnly).Schools, len(admin.schools), "Übersicht lesen reads the responsibilities")
	for _, write := range []*httptest.ResponseRecorder{
		traegerJSON(t, router, readOnly, http.MethodPut, schoolPartyPath(school, "schultraeger"), body),
		traegerJSON(t, router, readOnly, http.MethodDelete, schoolPartyPath(school, "gemeinde"), nil),
		traegerJSON(t, router, readOnly, http.MethodPut, "/traeger/settings/values/responsibility.contracts", map[string]any{"value": "gemeinde"}),
	} {
		assert.Equal(t, http.StatusForbidden, write.Code, "writing needs Einstellungen: %s", write.Body.String())
	}
	unauthenticated := traegerJSON(t, router, "", http.MethodGet, responsibilitiesPath, nil)
	assert.Equal(t, http.StatusUnauthorized, unauthenticated.Code, unauthenticated.Body.String())
}

func TestTraegerResponsibilitiesQueryBudget(t *testing.T) {
	t.Parallel()
	db, router := newResponsibilityPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Budget Zuständigkeiten", identityaccess.TraegerRoleAdministration)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, responsibilitiesPath, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	empty := read()
	body := schoolPartyBody{Name: "Gemeinde Hardt", Street: "Rathausplatz 1", PostalCode: "41749", City: "Viersen"}
	for _, school := range office.schools {
		saveSchoolParty(t, router, office.token, school, "gemeinde", body)
		saveSchoolParty(t, router, office.token, school, "schultraeger", body)
	}
	setSchoolResponsibility(t, db, office.schools[0], "responsibility.staff", "gemeinde")
	assert.Len(t, read().Statements, len(empty.Statements), "the overview reads the same statements for any number of bodies and overrides")
	querybudgets.AssertQueryBudget(t, "api.traeger.responsibilities", empty)
}
