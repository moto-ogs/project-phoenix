package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// The families of contracts without a mail address through the routes
// (#7161, ADR 0319): the Träger-Büro joins siblings imported without an
// address to one family, the monthly run and the mandate import count them
// as one, and leaving gives each its own family back.

const contractFamiliesPath = "/traeger/contract-families"

type contractFamiliesBody struct {
	Version   string `json:"version"`
	Contracts []struct {
		ContractID       wireID `json:"contract_id"`
		FamilyContractID wireID `json:"family_contract_id"`
		ChildFirstName   string `json:"child_first_name"`
		SchoolName       string `json:"school_name"`
		PartyName        string `json:"party_name"`
	} `json:"contracts"`
	Events []struct {
		Action                   string  `json:"action"`
		ContractID               wireID  `json:"contract_id"`
		FamilyContractID         wireID  `json:"family_contract_id"`
		PreviousFamilyContractID wireID  `json:"previous_family_contract_id"`
		ChildFirstName           string  `json:"child_first_name"`
		AccountID                *wireID `json:"account_id"`
	} `json:"events"`
}

// families maps each listed contract to the leading contract of its family.
func (b contractFamiliesBody) families() map[int64]int64 {
	families := map[int64]int64{}
	for _, contract := range b.Contracts {
		families[int64(contract.ContractID)] = int64(contract.FamilyContractID)
	}
	return families
}

// withoutMail takes the mail address off the parties of the contracts, as
// the import of the OGS Connect master data leaves them (ADR 0232 point 7).
func withoutMail(t *testing.T, f careBillingFixture, contractIDs ...int64) {
	t.Helper()
	for _, id := range contractIDs {
		_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contract_parties SET email = '' WHERE contract_id = ?`, id)
		require.NoError(t, err)
	}
}

func readFamilies(t *testing.T, f careBillingFixture, token string) contractFamiliesBody {
	t.Helper()
	rec := traegerJSON(t, f.traeger, token, http.MethodGet, contractFamiliesPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[contractFamiliesBody](t, rec.Body.Bytes())
}

// joinFamily joins the contracts under lead on the version just read.
func joinFamily(t *testing.T, f careBillingFixture, lead int64, contractIDs ...int64) *httptest.ResponseRecorder {
	t.Helper()
	ids := make([]string, len(contractIDs))
	for i, id := range contractIDs {
		ids[i] = strconv.FormatInt(id, 10)
	}
	return traegerJSON(t, f.traeger, f.office.token, http.MethodPost, contractFamiliesPath, map[string]any{"contract_ids": ids,
		"family_contract_id": strconv.FormatInt(lead, 10), "expected_version": readFamilies(t, f, f.office.token).Version})
}

func leaveFamily(t *testing.T, f careBillingFixture, contractID int64) *httptest.ResponseRecorder {
	t.Helper()
	return traegerJSON(t, f.traeger, f.office.token, http.MethodPost, contractFamiliesPath+"/"+strconv.FormatInt(contractID, 10)+"/leave",
		map[string]any{"expected_version": readFamilies(t, f, f.office.token).Version})
}

// Ispringen (#7161): Anna and Ben were imported without a mail address,
// each a family of its own, and pay the price of the first child, 78,00 €.
// Joined, Ben is the second child: 4 × 12,50 + 10,50 = 60,50 €. Each keeps
// the debtor number of its own child (#7007). Leaving gives Ben the price of
// the first child back.
func TestJoinedSiblingsWithoutAMailAddressGetTheSiblingPriceThroughTheRoutes(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Familie ohne Adresse")
	ispringen := f.office.schools[0]
	anna := careContract(t, f.db, f.office.organization, ispringen, "Anna", careReductionStart, sjrModule2Services()...)
	ben := careContract(t, f.db, f.office.organization, ispringen, "Ben", careReductionStart, sjrModule2Services()...)
	withoutMail(t, f, anna, ben)
	rec := putCarePriceList(t, f.traeger, f.office.token, ispringenModule2(ispringen))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	f.saveRule(t, careRule("sibling", "Geschwisterpreis Ispringen", []int64{ispringen},
		map[string]any{"sibling_from_child": 2, "tariff_sibling_price": true}))
	childScope(t, f)
	require.Equal(t, http.StatusOK, setChildNumber(t, f, f.office.token, fmt.Sprintf("contract:%d", anna), "Anna", "60101"))
	require.Equal(t, http.StatusOK, setChildNumber(t, f, f.office.token, fmt.Sprintf("contract:%d", ben), "Ben", "60102"))

	set := readFamilies(t, f, f.office.token)
	assert.Equal(t, map[int64]int64{anna: anna, ben: ben}, set.families(), "each contract without an address is a family of its own")
	assert.Empty(t, set.Events)

	run := f.startRun(t, careMonth)
	invoices := func() (map[int64]int64, map[int64]string) {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, careRunPath(int64(run.ID), ""), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		totals, numbers := map[int64]int64{}, map[int64]string{}
		for _, invoice := range decodeSchoolPortalData[struct {
			Invoices []struct {
				ContractID   wireID `json:"contract_id"`
				TotalCents   int64  `json:"total_cents"`
				DebtorNumber string `json:"debtor_number"`
			} `json:"invoices"`
		}](t, rec.Body.Bytes()).Invoices {
			totals[int64(invoice.ContractID)], numbers[int64(invoice.ContractID)] = invoice.TotalCents, invoice.DebtorNumber
		}
		return totals, numbers
	}
	totals, _ := invoices()
	assert.Equal(t, map[int64]int64{anna: 7800, ben: 7800}, totals, "apart, both pay the price of the first child")

	rec = joinFamily(t, f, anna, anna, ben)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	set = decodeSchoolPortalData[contractFamiliesBody](t, rec.Body.Bytes())
	assert.Equal(t, map[int64]int64{anna: anna, ben: anna}, set.families(), "Anna leads the family")
	require.Len(t, set.Events, 1, "only Ben's family changed")
	assert.Equal(t, "join_family", set.Events[0].Action)
	assert.Equal(t, ben, int64(set.Events[0].ContractID))
	assert.Equal(t, anna, int64(set.Events[0].FamilyContractID))
	assert.Equal(t, ben, int64(set.Events[0].PreviousFamilyContractID))
	assert.Equal(t, "Ben", set.Events[0].ChildFirstName)
	assert.NotNil(t, set.Events[0].AccountID, "the trail names the account")

	totals, numbers := invoices()
	assert.Equal(t, map[int64]int64{anna: 7800, ben: 6050}, totals, "joined, Ben pays the sibling price")
	assert.Equal(t, map[int64]string{anna: "60101", ben: "60102"}, numbers, "each child keeps its own debtor number")

	rec = leaveFamily(t, f, ben)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	set = decodeSchoolPortalData[contractFamiliesBody](t, rec.Body.Bytes())
	assert.Equal(t, map[int64]int64{anna: anna, ben: ben}, set.families(), "leaving restores the families before")
	require.Len(t, set.Events, 2)
	assert.Equal(t, "leave_family", set.Events[0].Action, "the newest change first")
	assert.Equal(t, anna, int64(set.Events[0].PreviousFamilyContractID))
	totals, numbers = invoices()
	assert.Equal(t, map[int64]int64{anna: 7800, ben: 7800}, totals)
	assert.Equal(t, map[int64]string{anna: "60101", ben: "60102"}, numbers)
}

// The mandate import (#7078) sees one mandate for joined siblings: apart,
// the second row of the same reference is a conflict, joined it repeats the
// family's mandate, and the import stores it once.
func TestJoinedSiblingsShareTheirMandateInTheImport(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Familie ohne Adresse Mandat")
	school := f.office.schools[0]
	mia := careContract(t, f.db, f.office.organization, school, "Mia", careMonth, sjrServices()...)
	noah := careContract(t, f.db, f.office.organization, school, "Noah", careMonth, sjrServices()...)
	withoutMail(t, f, mia, noah)
	saveCreditor(t, f, map[string]any{"creditor_id": sepaCreditorID, "prenotification_days": 14, "missing_mandate": "transfer"})
	childScope(t, f)
	require.Equal(t, http.StatusOK, setChildNumber(t, f, f.office.token, fmt.Sprintf("contract:%d", mia), "Mia", "60101"))
	require.Equal(t, http.StatusOK, setChildNumber(t, f, f.office.token, fmt.Sprintf("contract:%d", noah), "Noah", "60102"))
	file := ogsConnectFile(
		fmt.Sprintf("Beispiel;Mia;60101;Eva Beispiel;%s;OGS-S1;15.08.2024 10:12;RCUR", sepaIBAN),
		fmt.Sprintf("Beispiel;Noah;60102;Eva Beispiel;%s;OGS-S1;15.08.2024 10:12;RCUR", sepaIBAN),
	)
	preview := func() sepaImportBody {
		rec := importForm(t, f.traeger, f.office.token, sepaImportPreviewPath, "stammdaten.csv", file, ogsConnectMapping())
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decodeSchoolPortalData[sepaImportBody](t, rec.Body.Bytes())
	}
	apart := preview()
	require.Len(t, apart.Rows, 2)
	assert.Equal(t, "ready", apart.Rows[0].Status)
	assert.Equal(t, "conflict", apart.Rows[1].Status, "apart, the sibling's row names another family's mandate")

	rec := joinFamily(t, f, mia, mia, noah)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	joined := preview()
	require.Len(t, joined.Rows, 2)
	assert.Equal(t, "ready", joined.Rows[0].Status)
	assert.Equal(t, "same_mandate", joined.Rows[1].Status, "joined, the sibling repeats the family's mandate")

	rec = applyImport(t, f.traeger, f.office.token, "stammdaten.csv", file, ogsConnectMapping())
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, 1, countMandates(t, f), "the family has one mandate")
}

// The routes need the right "Verträge verwalten" or "Abrechnung", find no
// contract of another Träger, refuse a contract with a mail address, a
// change on another version and a leading contract that leads others, and
// record every read in the trail of the contracts.
func TestContractFamiliesAreCheckedNeedTheRightAndAreRecorded(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Familie Prüfung")
	school := f.office.schools[0]
	mia := careContract(t, f.db, f.office.organization, school, "Mia", careReductionStart, sjrServices()...)
	noah := careContract(t, f.db, f.office.organization, school, "Noah", careReductionStart, sjrServices()...)
	lea := careContract(t, f.db, f.office.organization, school, "Lea", careReductionStart, sjrServices()...)
	withoutMail(t, f, mia, noah)

	set := readFamilies(t, f, f.office.token)
	assert.Equal(t, map[int64]int64{mia: mia, noah: noah}, set.families(), "a contract with a mail address is no family to join")

	rec := joinFamily(t, f, mia, mia, lea)
	assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.family_refused")
	assert.Contains(t, rec.Body.String(), `"reason":"has_email"`)
	rec = joinFamily(t, f, mia, mia)
	assert.Equal(t, http.StatusBadRequest, rec.Code, "one contract is no family: %s", rec.Body.String())
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, contractFamiliesPath, map[string]any{
		"contract_ids": []string{fmt.Sprint(mia), fmt.Sprint(noah)}, "family_contract_id": fmt.Sprint(mia), "expected_version": "stale"})
	assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "general.changed_since_read")
	rec = leaveFamily(t, f, noah)
	assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"reason":"not_joined"`)

	rec = joinFamily(t, f, mia, mia, noah)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = leaveFamily(t, f, mia)
	assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"reason":"leads"`, "the leading contract leaves last")

	foreign := newTraegerOffice(t, f.db, f.traeger, "Träger Familie Prüfung Fremd", identityaccess.TraegerRoleBilling)
	testpkg.OwnTraegerCareContracts(t, f.db, foreign.organization)
	other := careBillingFixture{db: f.db, traeger: f.traeger, office: foreign}
	assert.Empty(t, readFamilies(t, other, foreign.token).Contracts, "no contract of another Träger")
	rec = joinFamily(t, other, mia, mia, noah)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.contract_not_found")
	rec = leaveFamily(t, other, noah)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())

	administration := traegerColleague(t, reviewFixture{db: f.db, traeger: f.traeger, office: f.office}, identityaccess.TraegerRoleAdministration)
	assert.Len(t, readFamilies(t, f, administration).Contracts, 2, "the office that imports joins too")
	readOnly := traegerColleague(t, reviewFixture{db: f.db, traeger: f.traeger, office: f.office}, identityaccess.TraegerRoleReadOnly)
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, contractFamiliesPath},
		{http.MethodGet, contractFamiliesPath + "/export"},
		{http.MethodPost, contractFamiliesPath},
		{http.MethodPost, contractFamiliesPath + "/" + strconv.FormatInt(noah, 10) + "/leave"},
	} {
		rec := traegerJSON(t, f.traeger, readOnly, request.method, request.path, map[string]any{"expected_version": set.Version})
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s %s without the right: %s", request.method, request.path, rec.Body.String())
	}

	var trail []string
	require.NoError(t, f.db.NewRaw(`SELECT action FROM care_contract.contract_events WHERE organization_id = ?
		AND action IN ('join_family', 'leave_family') ORDER BY id`, f.office.organization).Scan(context.Background(), &trail))
	assert.Equal(t, []string{"join_family"}, trail, "only the stored change stands in the trail")
	var reads int
	require.NoError(t, f.db.NewRaw(`SELECT COUNT(*) FROM care_contract.contract_events WHERE organization_id = ? AND action = 'read'
		AND details->>'view' = 'care_contract_families' AND details->'contract_ids' @> to_jsonb(?::bigint) AND account_id IS NOT NULL`,
		f.office.organization, mia).Scan(context.Background(), &reads))
	assert.GreaterOrEqual(t, reads, 5, "every read of the families stands in the trail with the account")
}

// The list of the families (#4691) shows a joined family once, with the
// number of its leading contract; the number of the led contract rests and
// comes back when it leaves (ADR 0319 points 3 and 4).
func TestJoinedFamilyIsListedOnceAndItsNumbersRest(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Familie Liste")
	mia := careContract(t, f.db, f.office.organization, f.office.schools[0], "Mia", careReductionStart, sjrServices()...)
	noah := careContract(t, f.db, f.office.organization, f.office.schools[0], "Noah", careReductionStart, sjrServices()...)
	withoutMail(t, f, mia, noah)
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO parent_billing.family_billing (organization_id, family_email,
			care_contract_id, recipient_kind, payment_method, due_day, debtor_number) VALUES
		(?0, ?1, ?2, 'applicant', 'transfer', 5, '30100'), (?0, ?3, ?4, 'applicant', 'transfer', 5, '30101')`,
		f.office.organization, fmt.Sprintf("contract:%d", mia), mia, fmt.Sprintf("contract:%d", noah), noah)
	require.NoError(t, err)
	listed := func() map[string]string {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, "/traeger/billing-families", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		numbers := map[string]string{}
		for _, family := range decodeSchoolPortalData[[]struct {
			FamilyEmail        string `json:"family_email"`
			FamilyDebtorNumber string `json:"family_debtor_number"`
		}](t, rec.Body.Bytes()) {
			numbers[family.FamilyEmail] = family.FamilyDebtorNumber
		}
		return numbers
	}
	miaKey, noahKey := fmt.Sprintf("contract:%d", mia), fmt.Sprintf("contract:%d", noah)
	assert.Equal(t, map[string]string{miaKey: "30100", noahKey: "30101"}, listed())

	require.Equal(t, http.StatusOK, joinFamily(t, f, mia, mia, noah).Code)
	assert.Equal(t, map[string]string{miaKey: "30100"}, listed(), "the joined family is listed once with Mia's number")
	// #4718: the families as a file, one row per contract with its family.
	lines := billingListCSV(t, f.traeger, f.office.token, contractFamiliesPath+"/export")
	assert.Equal(t, "Vertrag Nr.;Nachname;Vorname;Geburtsdatum;Eltern;Betreuungsort;Familie", lines[0])
	file := strings.Join(lines, "\n")
	assert.Contains(t, file, fmt.Sprintf("%d;Beispiel;Mia;;Eva Beispiel;Grundschule Ispringen;Führt die Familie", mia))
	assert.Contains(t, file, fmt.Sprintf("%d;Beispiel;Noah;;Eva Beispiel;Grundschule Ispringen;Geschwister von Vertrag Nr. %d", noah, mia))
	assertTraegerListFormats(t, f.traeger, f.office.token, contractFamiliesPath+"/export", "geschwister-ohne-mail-adresse")
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, "/traeger/family-billing/contracts/"+strconv.FormatInt(noah, 10), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), miaKey, "Noah's contract answers the deviation of the joined family")

	require.Equal(t, http.StatusOK, leaveFamily(t, f, noah).Code)
	assert.Equal(t, map[string]string{miaKey: "30100", noahKey: "30101"}, listed(), "leaving brings Noah's number back")
}

// The page reads the same statements for any number of contracts.
func TestContractFamiliesListQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Familie Budget")
	list := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		req := httptest.NewRequest(http.MethodGet, contractFamiliesPath, nil)
		req.Header.Set("Authorization", "Bearer "+f.office.token)
		rec := httptest.NewRecorder()
		f.traeger.ServeHTTP(rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Queries())
	}
	first := careContract(t, f.db, f.office.organization, f.office.schools[0], "Mia", careReductionStart, sjrServices()...)
	second := careContract(t, f.db, f.office.organization, f.office.schools[0], "Noah", careReductionStart, sjrServices()...)
	withoutMail(t, f, first, second)
	require.Equal(t, http.StatusOK, joinFamily(t, f, first, first, second).Code)
	measured := list()
	for _, child := range []string{"Lea", "Ole"} {
		withoutMail(t, f, careContract(t, f.db, f.office.organization, f.office.schools[0], child, careReductionStart, sjrServices()...))
	}
	assert.Len(t, list().Statements, len(measured.Statements), "the page reads the same statements for any number of contracts")
	querybudgets.AssertQueryBudget(t, "api.traeger.contract_families", measured)
}
