package api

import (
	"context"
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

// The children of a family through the routes (#5918, ADR 0088 section 4
// addendum 2026-11-08). The contracts start on careReductionStart, so they
// are in force for the run month and in the window of the page.

const familyChildrenPath = "/traeger/family-children"

type familyChildrenSetBody struct {
	Families []struct {
		ContractID     wireID `json:"contract_id"`
		RecipientEmail string `json:"recipient_email"`
		Status         string `json:"status"`
		Children       []struct {
			ContractID wireID `json:"contract_id"`
		} `json:"children"`
		Count *struct {
			ConfirmedChildren *int `json:"confirmed_children"`
		} `json:"count"`
	} `json:"families"`
	Rules []careRuleBody `json:"rules"`
}

func familyChildren(contractID int64, children int, from string) map[string]any {
	return map[string]any{"contract_id": contractID, "children": children, "valid_from": from}
}

// A family of three with one child under contract: the sibling rule that
// counts the family makes Mia the 3rd child. Mia books Mon until 14:00
// (32,00 €) and Tue until 16:30 (45,50 €): 77,50 € − 50 % = 38,75 €. The
// release keeps rank and number; removing the number later never reaches it.
func TestFamilyChildrenCountInTheSiblingRuleThroughTheRoutes(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kinderzahl Kette")
	school := f.office.schools[0]
	mia := careContract(t, f.db, f.office.organization, school, "Mia", careReductionStart, sjrServices()...)
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, careTariffsPath, carePriceList(school, "2029-09-01", 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rules := f.saveRule(t, careRule("sibling", "Geschwister mit Familie", []int64{school},
		map[string]any{"sibling_from_child": 2, "discount_basis_points": 5000, "counts_family_children": true}))
	require.Len(t, rules.Rules, 1)

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, familyChildren(mia, 3, "2026-09-01"))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	set := decodeSchoolPortalData[familyChildrenSetBody](t, rec.Body.Bytes())
	require.Len(t, set.Families, 1)
	assert.Equal(t, "confirmed", set.Families[0].Status)
	require.NotNil(t, set.Families[0].Count)
	assert.Equal(t, 3, *set.Families[0].Count.ConfirmedChildren)
	require.Len(t, set.Rules, 1, "the page names the rule that counts the family")
	assert.Equal(t, "Geschwister mit Familie", set.Rules[0].Name)

	run := f.startRun(t, careMonth)
	preview := decodeSchoolPortalData[careReductionRunBody](t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
		careRunPath(int64(run.ID), ""), nil).Body.Bytes())
	require.Len(t, preview.Invoices, 1)
	invoice := preview.Invoices[0]
	assert.Equal(t, int64(3875), invoice.TotalCents)
	require.Len(t, invoice.Reductions, 1)
	assert.Equal(t, 3, *invoice.Reductions[0].ChildRank, "Mia is the 3rd child")
	assert.Equal(t, 3, *invoice.Reductions[0].FamilyChildren, "of three")

	// A future confirmation must not remove the current draft's discount.
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, familyChildren(mia, 2, "2030-02-01"))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview = decodeSchoolPortalData[careReductionRunBody](t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
		careRunPath(int64(run.ID), ""), nil).Body.Bytes())
	require.Len(t, preview.Invoices, 1)
	assert.Equal(t, int64(3875), preview.Invoices[0].TotalCents, "a future confirmation preserves the draft discount")
	require.NotEmpty(t, preview.Invoices[0].Reductions)
	assert.Equal(t, 3, *preview.Invoices[0].Reductions[0].FamilyChildren)

	// Correcting the successor's end must not revive either open interval.
	correction := familyChildren(mia, 2, "2030-02-01")
	correction["valid_until"] = "2030-02-28"
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, correction)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	marchRun := f.startRun(t, "2030-03-01")
	march := decodeSchoolPortalData[careReductionRunBody](t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
		careRunPath(int64(marchRun.ID), ""), nil).Body.Bytes())
	require.Len(t, march.Invoices, 1)
	assert.Equal(t, int64(7750), march.Invoices[0].TotalCents, "the corrected expiry ends the sibling discount")
	assert.Empty(t, march.Invoices[0].Reductions)
	assert.Equal(t, 1, march.UncountedFamilies, "the expired family needs a new confirmation")
	preview = decodeSchoolPortalData[careReductionRunBody](t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
		careRunPath(int64(run.ID), ""), nil).Body.Bytes())
	require.Len(t, preview.Invoices, 1)
	assert.Equal(t, int64(3875), preview.Invoices[0].TotalCents, "the correction preserves the earlier billing period")

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), "/release"),
		map[string]any{"document_count": preview.PreviewCount, "total_cents": preview.PreviewCents, "fingerprint": preview.Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodDelete, familyChildrenPath+"/"+strconv.FormatInt(mia, 10), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	released := decodeSchoolPortalData[careReductionRunBody](t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
		careRunPath(int64(run.ID), ""), nil).Body.Bytes())
	require.Len(t, released.Invoices, 1)
	assert.Equal(t, int64(3875), released.Invoices[0].TotalCents, "the released run keeps the amount")
	assert.Equal(t, 3, *released.Invoices[0].Reductions[0].FamilyChildren, "and the number it counted")
}

// The routes check the number and the Träger, need
// the right "Abrechnung" and record every read and change.
func TestFamilyChildrenAreCheckedNeedTheRightAndAreRecorded(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kinderzahl Prüfung")
	school := f.office.schools[0]
	mia := careContract(t, f.db, f.office.organization, school, "Mia", careReductionStart, sjrServices()...)
	for _, body := range []map[string]any{
		familyChildren(mia, 0, "2026-09-01"),
		familyChildren(mia, 21, "2026-09-01"),
		familyChildren(mia, -1, "2026-09-01"),
		{"contract_id": mia, "children": 3},
		{"contract_id": mia, "children": 3, "valid_from": "2026-09-01", "valid_until": "2026-08-31"},
		{"contract_id": mia, "children": 2.5, "valid_from": "2026-09-01"},
	} {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, body)
		assert.Equal(t, http.StatusBadRequest, rec.Code, "%v: %s", body, rec.Body.String())
		assert.Contains(t, rec.Body.String(), "parent_billing.family_children_invalid")
	}
	foreign := newTraegerOffice(t, f.db, f.traeger, "Träger Kinderzahl Prüfung Fremd", identityaccess.TraegerRoleBilling)
	testpkg.OwnTraegerCareContracts(t, f.db, foreign.organization)
	rec := traegerJSON(t, f.traeger, foreign.token, http.MethodPut, familyChildrenPath, familyChildren(mia, 2, "2026-09-01"))
	assert.Equal(t, http.StatusNotFound, rec.Code, "another Träger finds no family of the contract: %s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.family_children_not_found")

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, familyChildren(mia, 2, "2026-09-01"))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, foreign.token, http.MethodDelete, familyChildrenPath+"/"+strconv.FormatInt(mia, 10), nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, foreign.token, http.MethodGet, familyChildrenPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "example.org", "no family of another Träger")
	assert.Len(t, billingListCSV(t, f.traeger, foreign.token, familyChildrenPath+"/export"), 1, "the file of another Träger holds no family")

	password := testpkg.NewTestPassword()
	account := traegerAccount(t, f.db, password)
	testpkg.CreateTestTraegerMember(t, f.db, f.office.organization, account.ID, identityaccess.TraegerRoleAdministration)
	code, answer := traegerSignIn(t, f.traeger, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, familyChildrenPath},
		{http.MethodGet, familyChildrenPath + "/export"},
		{http.MethodPut, familyChildrenPath},
		{http.MethodDelete, familyChildrenPath + "/" + strconv.FormatInt(mia, 10)},
	} {
		rec := traegerJSON(t, f.traeger, answer.AccessToken, request.method, request.path, familyChildren(mia, 4, "2026-09-01"))
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s %s without the right: %s", request.method, request.path, rec.Body.String())
	}

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodGet, familyChildrenPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var trail []struct {
		Action   string `bun:"action"`
		Actor    string `bun:"actor"`
		Children *int   `bun:"children"`
		Account  *int64 `bun:"actor_account_id"`
	}
	require.NoError(t, f.db.NewRaw(`SELECT action, actor, children, actor_account_id FROM parent_billing.family_child_count_events
		WHERE organization_id = ? AND care_contract_id = ? ORDER BY id`, f.office.organization, mia).Scan(context.Background(), &trail))
	require.Len(t, trail, 3, "the confirmation, the read after it and one more read")
	assert.Equal(t, []string{"confirm", "read", "read"}, []string{trail[0].Action, trail[1].Action, trail[2].Action})
	assert.Equal(t, "office", trail[0].Actor)
	require.NotNil(t, trail[0].Children)
	assert.Equal(t, 2, *trail[0].Children, "the change keeps its value")
	for _, entry := range trail {
		assert.NotNil(t, entry.Account, "every entry names the account")
	}

	// #4718: the families as a file. Each download reads like the page and
	// stands in the trail of the number.
	lines := billingListCSV(t, f.traeger, f.office.token, familyChildrenPath+"/export")
	assert.Equal(t, "Nachname;Vorname;E-Mail;Kinder mit Vertrag;Angabe der Eltern;Bestätigte Kinderzahl;Gültig;Stand", lines[0])
	assert.Contains(t, strings.Join(lines, "\n"), ";–;2;ab 01.09.2026;Bestätigt")
	assertTraegerListFormats(t, f.traeger, f.office.token, familyChildrenPath+"/export", "kinderzahl")
	var reads int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM parent_billing.family_child_count_events
		WHERE organization_id = ? AND care_contract_id = ? AND action = 'read'`, f.office.organization, mia).Scan(context.Background(), &reads))
	assert.Equal(t, 5, reads, "two reads of the page and three downloads")
}

// Birkenfeld (#7356): an imported contract has no mail address, so it is a
// family of its own, known by its contract. Its confirmed number of two
// makes Mia the 2nd child without a second contract: 77,50 € − 50 % =
// 38,75 €. Noah's family has no number: he is the 1st child and the review
// names his contract as missing. Removing Mia's number names hers too.
func TestFamilyChildrenOfContractsWithoutAMailAddressThroughTheRoutes(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kinderzahl ohne Adresse")
	school := f.office.schools[0]
	mia := careContract(t, f.db, f.office.organization, school, "Mia", careReductionStart, sjrServices()...)
	noah := careContract(t, f.db, f.office.organization, school, "Noah", careReductionStart, sjrServices()...)
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contract_parties SET email = '' WHERE contract_id IN (?, ?)`, mia, noah)
	require.NoError(t, err)
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, careTariffsPath, carePriceList(school, "2029-09-01", 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	f.saveRule(t, careRule("sibling", "Geschwister mit Familie", []int64{school},
		map[string]any{"sibling_from_child": 2, "discount_basis_points": 5000, "counts_family_children": true}))

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, familyChildren(mia, 2, "2026-09-01"))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	set := decodeSchoolPortalData[familyChildrenSetBody](t, rec.Body.Bytes())
	require.Len(t, set.Families, 2, "each contract without an address is a family of its own")
	states := map[int64]string{}
	for _, family := range set.Families {
		assert.Empty(t, family.RecipientEmail)
		states[int64(family.ContractID)] = family.Status
	}
	assert.Equal(t, map[int64]string{mia: "confirmed", noah: "missing"}, states)

	run := f.startRun(t, careMonth)
	type reviewBody struct {
		careReductionRunBody
		UncountedContracts []struct {
			ContractID     wireID `json:"contract_id"`
			ChildFirstName string `json:"child_first_name"`
			Status         string `json:"status"`
		} `json:"uncounted_contracts"`
	}
	review := func() (map[int64]int64, reviewBody) {
		body := decodeSchoolPortalData[reviewBody](t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
			careRunPath(int64(run.ID), ""), nil).Body.Bytes())
		totals := map[int64]int64{}
		for _, invoice := range body.Invoices {
			totals[int64(invoice.ContractID)] = invoice.TotalCents
		}
		return totals, body
	}
	totals, preview := review()
	assert.Equal(t, map[int64]int64{mia: 3875, noah: 7750}, totals, "Mia pays the sibling price, Noah the full one")
	assert.Equal(t, 1, preview.UncountedFamilies)
	require.Len(t, preview.UncountedContracts, 1)
	assert.Equal(t, noah, preview.UncountedContracts[0].ContractID)
	assert.Equal(t, "missing", preview.UncountedContracts[0].Status)

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodDelete, familyChildrenPath+"/"+strconv.FormatInt(mia, 10), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	totals, preview = review()
	assert.Equal(t, map[int64]int64{mia: 7750, noah: 7750}, totals)
	assert.Equal(t, 2, preview.UncountedFamilies)
	lines := billingListCSV(t, f.traeger, f.office.token, familyChildrenPath+"/export")
	assert.Contains(t, strings.Join(lines, "\n"), "Vertrag Nr. "+strconv.FormatInt(mia, 10), "the file names a family without an address by its contract")

	var trail []string
	require.NoError(t, f.db.NewRaw(`SELECT action FROM parent_billing.family_child_count_events
		WHERE organization_id = ? AND care_contract_id = ? AND action <> 'read' ORDER BY id`, f.office.organization, mia).Scan(context.Background(), &trail))
	assert.Equal(t, []string{"confirm", "delete"}, trail, "every change stands in the trail of the contract")
}

// The page reads the same statements for any number of families.
func TestFamilyChildrenListQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kinderzahl Budget")
	school := f.office.schools[0]
	list := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		req := httptest.NewRequest(http.MethodGet, familyChildrenPath, nil)
		req.Header.Set("Authorization", "Bearer "+f.office.token)
		rec := httptest.NewRecorder()
		f.traeger.ServeHTTP(rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Queries())
	}
	first := careContract(t, f.db, f.office.organization, school, "Mia", careReductionStart, sjrServices()...)
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, familyChildren(first, 2, "2026-09-01"))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	measured := list()
	for _, child := range []string{"Noah", "Lea"} {
		contract := careContract(t, f.db, f.office.organization, f.office.schools[1], child, careReductionStart, sjrServices()...)
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, familyChildren(contract, 3, "2026-09-01"))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	assert.Len(t, list().Statements, len(measured.Statements), "the page reads the same statements for any number of families")
	querybudgets.AssertQueryBudget(t, "api.traeger.family_children", measured)
}
