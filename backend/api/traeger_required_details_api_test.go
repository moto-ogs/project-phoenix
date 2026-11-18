package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type requiredDetailsBody struct {
	Missing []string `json:"missing"`
}

func requiredDetails(t *testing.T, f holidayRegistrationFixture, token string) []string {
	t.Helper()
	rec := traegerJSON(t, f.traeger, token, http.MethodGet, "/traeger/required-details", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[requiredDetailsBody](t, rec.Body.Bytes()).Missing
}

// TestTraegerRequiredDetailsNameOnlyWhatTheBookedModulesNeed pins #7177: the
// Träger-Portal names the details the Träger still has to enter, only for
// the modules a school of the Träger books, and an entered detail leaves
// the list. Every member of the Träger sees it.
func TestTraegerRequiredDetailsNameOnlyWhatTheBookedModulesNeed(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixture(t)
	office := newTraegerOffice(t, f.db, f.traeger, "Träger Pflichtangaben", identityaccess.TraegerRoleAdministration)
	testpkg.OwnTraegerMasterData(t, f.db, office.organization)
	north, south := office.schools[0], office.schools[1]
	book := func(school int64, key string, booked bool) {
		value := "false"
		if booked {
			value = "true"
		}
		testpkg.SetTestTenantSetting(t, f.db, school, key, value)
	}
	for _, school := range office.schools {
		for _, key := range []string{configModels.KeyModuleVertraege, configModels.KeyModuleElternbeitraege, configModels.KeyModuleFerienbetreuung} {
			book(school, key, false)
		}
	}
	assert.Empty(t, requiredDetails(t, f, office.token), "no booked module needs a detail")

	book(north, configModels.KeyModuleVertraege, true)
	assert.Equal(t, []string{"letterhead"}, requiredDetails(t, f, office.token), "contracts need the letterhead only")

	book(south, configModels.KeyModuleFerienbetreuung, true)
	assert.Equal(t, []string{"letterhead", "bank_account", "sepa_creditor", "number_range_holiday"}, requiredDetails(t, f, office.token),
		"one school booking holiday care is enough")

	book(north, configModels.KeyModuleElternbeitraege, true)
	assert.Equal(t, []string{"letterhead", "bank_account", "sepa_creditor", "number_range_holiday", "number_range_care"},
		requiredDetails(t, f, office.token))

	// A letterhead of blanks or without an address is incomplete.
	setLetterhead := func(text string) {
		rec := traegerJSON(t, f.traeger, office.token, http.MethodPut, "/traeger/settings/values/"+configModels.KeyBrandingLetterheadText, map[string]any{"value": text})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	setLetterhead(" \n ")
	assert.Contains(t, requiredDetails(t, f, office.token), "letterhead")
	setLetterhead("Träger ohne Anschrift")
	assert.Contains(t, requiredDetails(t, f, office.token), "letterhead")
	setLetterhead(traegerTestLetterhead)
	rec := traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/master-data/bank-accounts", masterDataBankAccount{
		Label: "Elternbeiträge", AccountHolder: "Ganztag im Quartier e.V.", IBAN: traegerTestIBAN, BankName: "Beispielbank",
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	billing := traegerColleague(t, reviewFixture{holidayRegistrationFixture: f, office: office}, identityaccess.TraegerRoleBilling)
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, "/traeger/sepa-creditor",
		map[string]any{"creditor_id": "DE98ZZZ09999999999", "prenotification_days": 14, "missing_mandate": "transfer"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, "/traeger/number-ranges/holiday", map[string]any{"pattern": "FE-{NNNN}"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"number_range_care"}, requiredDetails(t, f, office.token))

	// A colleague who may only read still sees what is missing: the hint
	// tells whom to ask.
	reader := traegerColleague(t, reviewFixture{holidayRegistrationFixture: f, office: office}, identityaccess.TraegerRoleReadOnly)
	assert.Equal(t, []string{"number_range_care"}, requiredDetails(t, f, reader))
}
