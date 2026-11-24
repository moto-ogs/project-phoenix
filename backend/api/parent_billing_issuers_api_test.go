// Router-level tests for the issuer of the documents of a school (#8040,
// ADR 0322): the responsibility "Abrechnung" names the Träger or the
// school's Gemeinde; a Gemeinde with creditor identifier and account bills
// its school itself, from its own number range and with the family's
// mandate for its creditor identifier; an issued invoice keeps its issuer
// when the responsibility changes; no issuer reaches another Träger.
package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// gemeindeCreditorID is a valid creditor identifier of the Gemeinde, other
// than the Träger's sepaCreditorID.
const gemeindeCreditorID = "DE13ZZZ00000012345"

// storeBillingGemeinde gives the school a Gemeinde with creditor identifier
// and account and names it for "Abrechnung", as the Träger-Büro and the
// school's settings leave it (#4811).
func storeBillingGemeinde(t *testing.T, db bun.IDB, organizationID, schoolID int64) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO platform.school_responsible_parties (organization_id, school_id, kind, name,
			street, postal_code, city, contact_name, contact_phone, contact_email, creditor_id, account_holder, iban, bic, bank_name)
		VALUES (?, ?, 'gemeinde', 'Gemeinde Hardt', 'Rathausplatz 1', '41749', 'Viersen', 'Petra Sommer', '02162 1010',
			'kasse@hardt.example', ?, 'Gemeindekasse Hardt', 'DE02120300000000202051', 'BYLADEM1001', 'Deutsche Kreditbank')`,
		organizationID, schoolID, gemeindeCreditorID)
	require.NoError(t, err)
	_, err = db.ExecContext(context.Background(), `INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, 'responsibility.billing', to_jsonb('gemeinde'::text))`, schoolID)
	require.NoError(t, err)
}

type issuedCareInvoice struct {
	Number     string  `bun:"number"`
	IssuerKey  string  `bun:"issuer_key"`
	Sender     *string `bun:"sender"`
	Account    *string `bun:"account"`
	CreditorID *string `bun:"creditor_id"`
	Kind       string  `bun:"document_kind"`
}

func issuedCareInvoiceOf(t *testing.T, db bun.IDB, runID, contractID int64) issuedCareInvoice {
	t.Helper()
	var invoice issuedCareInvoice
	require.NoError(t, db.NewRaw(`SELECT number, issuer_key, issuer->>'sender_text' AS sender,
			issuer->'bank_account'->>'iban' AS account, creditor_id, document_kind
		FROM parent_billing.care_invoices WHERE run_id = ? AND care_contract_id = ?`, runID, contractID).Scan(context.Background(), &invoice))
	return invoice
}

func TestGemeindeBillsItsSchoolWithItsOwnRangeCreditorAndMandate(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Rechnungssteller")
	north, south := f.office.schools[0], f.office.schools[1]
	storeBillingGemeinde(t, f.db, f.office.organization, north)
	for _, school := range []int64{north, south} {
		rec := putCarePriceList(t, f.traeger, f.office.token, carePriceList(school, "2029-09-01", 3200))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	setTerms(t, f.traeger, f.office.token, "care", map[string]any{"payment_method": "direct_debit", "due_days": 10})
	saveCreditor(t, f, map[string]any{"creditor_id": sepaCreditorID, "prenotification_days": 3, "missing_mandate": "transfer"})
	// One family with a child at each school.
	lia := careContract(t, f.db, f.office.organization, north, "Lia", careMonth, sjrServices()...)
	noah := careContract(t, f.db, f.office.organization, south, "Noah", careMonth, sjrServices()...)
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contract_parties SET email = ? WHERE contract_id = ?`,
		fmt.Sprintf("eva.%d@example.org", lia), noah)
	require.NoError(t, err)

	// The Gemeinde's mandate binds its creditor identifier; the family
	// gives the Träger a mandate of its own for the other school.
	gemeinde := createMandate(t, f, mandateBody(lia, "GH-2026-0001"))
	assert.Equal(t, gemeindeCreditorID, gemeinde.CreditorID)
	traeger := createMandate(t, f, mandateBody(noah, "SJR-2026-0001"))
	assert.Equal(t, sepaCreditorID, traeger.CreditorID, "a mandate holds for one creditor: the family needs one per issuer")
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPost, sepaMandatesPath, mandateBody(lia, "GH-2026-0002"))
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.sepa_mandate_in_force")

	run := f.startRun(t, careMonth)
	rec = putRunDueDates(t, f.traeger, f.office.token, "care", int64(run.ID), dueDates("2030-01-02", "2030-01-04"))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	release := func() *httptest.ResponseRecorder {
		preview := sepaRun(t, f, int64(run.ID))
		return traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), "/release"),
			map[string]any{"document_count": preview.PreviewCount, "total_cents": preview.PreviewCents, "fingerprint": preview.Fingerprint})
	}

	// Without a choice the Gemeinde issues a fee notice, which needs the
	// legal remedy; it chooses the invoice.
	rec = release()
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.legal_remedy_missing")
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, "/traeger/billing-document-kinds/care",
		map[string]any{"document_kind": "invoice", "issuer_key": gemeindeCreditorID})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// The Gemeinde numbers in a range of its own: without it the release
	// names the Gemeinde.
	rec = release()
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.number_range_missing")
	assert.Contains(t, rec.Body.String(), gemeindeCreditorID)
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, numberRangesPath+"/care",
		map[string]any{"pattern": "GH-{JJJJ}-{NNN}", "issuer_key": gemeindeCreditorID})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = release()
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	byGemeinde, byTraeger := issuedCareInvoiceOf(t, f.db, int64(run.ID), lia), issuedCareInvoiceOf(t, f.db, int64(run.ID), noah)
	assert.Regexp(t, `^GH-\d{4}-001$`, byGemeinde.Number)
	assert.Equal(t, gemeindeCreditorID, byGemeinde.IssuerKey)
	require.NotNil(t, byGemeinde.Sender)
	assert.Equal(t, "Gemeinde Hardt\nRathausplatz 1\n41749 Viersen", *byGemeinde.Sender)
	require.NotNil(t, byGemeinde.Account)
	assert.Equal(t, "DE02120300000000202051", *byGemeinde.Account, "the letter asks to pay to the Gemeinde")
	require.NotNil(t, byGemeinde.CreditorID)
	assert.Equal(t, gemeindeCreditorID, *byGemeinde.CreditorID, "the Gemeinde collects with its own creditor identifier")
	assert.Equal(t, "invoice", byGemeinde.Kind)
	assert.Regexp(t, `^MB-\d{4}-0001$`, byTraeger.Number, "the Träger counts on in its own range")
	assert.Empty(t, byTraeger.IssuerKey)
	assert.Nil(t, byTraeger.Sender)
	require.NotNil(t, byTraeger.CreditorID)
	assert.Equal(t, sepaCreditorID, *byTraeger.CreditorID)

	// Each issuer collects its invoices in a file of its own.
	debits := func(query string) sepaDebitRunBody {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, sepaDebitRunPath(int64(run.ID), query), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decodeSchoolPortalData[sepaDebitRunBody](t, rec.Body.Bytes())
	}
	traegerFile, gemeindeFile := debits(""), debits("?issuer="+gemeindeCreditorID)
	// The mandates signed in 2026 expire before the collection in 2030: the
	// debits stay out, each in the file of its issuer.
	numbers := func(run sepaDebitRunBody) []string {
		var out []string
		for _, debit := range append(run.Debits, run.Left...) {
			out = append(out, debit.InvoiceNumber)
		}
		return out
	}
	assert.Equal(t, []string{byTraeger.Number}, numbers(traegerFile))
	assert.Equal(t, []string{byGemeinde.Number}, numbers(gemeindeFile))
	assert.Equal(t, gemeindeCreditorID, gemeindeFile.CreditorID)
	assert.Equal(t, "Gemeindekasse Hardt", gemeindeFile.CreditorName)

	// The Träger's Sollstellung books only the Träger's invoices: the
	// Gemeinde books its own in its budget.
	_, booked := sollstellung(t, f, int64(run.ID))
	assert.Contains(t, booked, byTraeger.Number)
	assert.NotContains(t, booked, byGemeinde.Number)

	// The school goes back to the Träger: the issued invoice keeps the
	// Gemeinde.
	_, err = f.db.ExecContext(context.Background(), `DELETE FROM config.setting_values WHERE tenant_id = ? AND setting_key = 'responsibility.billing'`, north)
	require.NoError(t, err)
	assert.Equal(t, byGemeinde, issuedCareInvoiceOf(t, f.db, int64(run.ID), lia), "a change of the responsibility changes no issued invoice")
	after := debits("?issuer=" + gemeindeCreditorID)
	assert.Equal(t, "Gemeindekasse Hardt", after.CreditorName, "its debit still goes to the account its invoice named")
	assert.Equal(t, []string{byGemeinde.Number}, numbers(after))
}

// TestIssuersStayWithTheirTraeger: the Gemeinde of another Träger's school
// is no issuer of this Träger; its state, number range and kind are out of
// reach.
func TestIssuersStayWithTheirTraeger(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Rechnungssteller eigen")
	foreign := newCareBillingFixture(t, "Träger Rechnungssteller fremd")
	storeBillingGemeinde(t, foreign.db, foreign.office.organization, foreign.office.schools[0])

	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, issuerStatusPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), gemeindeCreditorID)
	for _, path := range []string{numberRangesPath + "/care", "/traeger/billing-document-kinds/care"} {
		body := map[string]any{"pattern": "GH-{NNN}", "document_kind": "invoice", "issuer_key": gemeindeCreditorID}
		rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, path, body)
		assert.Equal(t, http.StatusBadRequest, rec.Code, path+": "+rec.Body.String())
	}
	rec = traegerJSON(t, foreign.traeger, foreign.office.token, http.MethodGet, issuerStatusPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), gemeindeCreditorID, "the Träger of the school sees its Gemeinde")
	rec = traegerJSON(t, foreign.traeger, foreign.office.token, http.MethodPut, numberRangesPath+"/care",
		map[string]any{"pattern": "GH-{NNN}", "issuer_key": gemeindeCreditorID})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodGet, numberRangesPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), gemeindeCreditorID, "the range of another Träger's Gemeinde stays there")
}

// TestACreditorIdentifierBelongsToOneAccount (ADR 0322 point 2): the
// schools of one creditor identifier share one debit file, so a second body
// may take the identifier only with the same account.
func TestACreditorIdentifierBelongsToOneAccount(t *testing.T) {
	t.Parallel()
	db, router := newResponsibilityPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Gläubiger-ID", identityaccess.TraegerRoleAdministration)
	north, south := office.schools[0], office.schools[1]
	saveSchoolParty(t, router, office.token, north, "gemeinde", gemeindeHardt)

	other := gemeindeHardt
	other.IBAN = "DE89370400440532013000"
	rec := traegerJSON(t, router, office.token, http.MethodPut, schoolPartyPath(south, "gemeinde"), other)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "traeger.school_party_creditor_account_conflict")
	assert.Contains(t, rec.Body.String(), `"school_name"`)

	// The debit file prints the account holder too: the same IBAN with
	// another holder is another account.
	renamed := gemeindeHardt
	renamed.AccountHolder = "Stadtkasse Hardt"
	rec = traegerJSON(t, router, office.token, http.MethodPut, schoolPartyPath(south, "gemeinde"), renamed)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "traeger.school_party_creditor_account_conflict")

	// The same account is the same creditor: the second school shares it.
	saveSchoolParty(t, router, office.token, south, "gemeinde", gemeindeHardt)
	// Another body of the first school keeps its own identifier.
	other.CreditorID = gemeindeCreditorID
	saveSchoolParty(t, router, office.token, north, "schultraeger", other)
}

type issuerStatusBody struct {
	Issuers []struct {
		Issuer struct {
			Key  string `json:"key"`
			Body string `json:"body"`
			Name string `json:"name"`
		} `json:"issuer"`
		SchoolIDs    []wireID `json:"school_ids"`
		NumberRanges []struct {
			Service string `json:"service"`
			Pattern string `json:"pattern"`
		} `json:"number_ranges"`
		DocumentKinds []struct {
			Service      string `json:"service"`
			DocumentKind string `json:"document_kind"`
		} `json:"document_kinds"`
		LegalRemedyMissing     bool `json:"legal_remedy_missing"`
		DirectDebitFamilies    int  `json:"direct_debit_families"`
		FamiliesWithoutMandate int  `json:"families_without_mandate"`
		CreditorIsTraegers     bool `json:"creditor_is_traegers"`
	} `json:"issuers"`
}

const issuerStatusPath = "/traeger/required-details/issuers"

func readIssuerStatus(t *testing.T, f careBillingFixture) issuerStatusBody {
	t.Helper()
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, issuerStatusPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[issuerStatusBody](t, rec.Body.Bytes())
}

// TestIssuerStatusNamesWhatTheGemeindeStillNeeds (ADR 0322 point 11): the
// overview of the responsibilities shows per body its number ranges, the
// kind of document and its legal remedy, and how many families pay by
// direct debit without a mandate for its creditor identifier. It counts, it
// names nobody, and it reads the same statements for any number of
// families.
func TestIssuerStatusNamesWhatTheGemeindeStillNeeds(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Rechnungssteller Stand")
	north := f.office.schools[0]
	storeBillingGemeinde(t, f.db, f.office.organization, north)
	setTerms(t, f.traeger, f.office.token, "care", map[string]any{"payment_method": "direct_debit", "due_days": 10})
	saveCreditor(t, f, map[string]any{"creditor_id": sepaCreditorID, "prenotification_days": 3, "missing_mandate": "transfer"})
	lia := careContract(t, f.db, f.office.organization, north, "Lia", careBillingDay().String(), sjrServices()...)
	careContract(t, f.db, f.office.organization, north, "Noah", careBillingDay().String(), sjrServices()...)
	createMandate(t, f, mandateBody(lia, "GH-S-0001"))

	measure := func() (issuerStatusBody, testpkg.QueryMeasurement) {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		req := httptest.NewRequest(http.MethodGet, issuerStatusPath, nil)
		req.Header.Set("Authorization", "Bearer "+f.office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, f.traeger, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.NotContains(t, rec.Body.String(), "Beispiel", "the state names no family")
		assert.NotContains(t, rec.Body.String(), "DE02120300000000202051", "the state carries no bank account")
		return decodeSchoolPortalData[issuerStatusBody](t, rec.Body.Bytes()), counter.Measurement(counter.Selects(""))
	}
	status, first := measure()
	require.Len(t, status.Issuers, 1, "only the body; the Träger has its own required details")
	gemeinde := status.Issuers[0]
	assert.Equal(t, gemeindeCreditorID, gemeinde.Issuer.Key)
	assert.Equal(t, "Gemeinde Hardt", gemeinde.Issuer.Name)
	assert.Equal(t, []wireID{wireID(north)}, gemeinde.SchoolIDs)
	for _, numberRange := range gemeinde.NumberRanges {
		assert.Empty(t, numberRange.Pattern, numberRange.Service+" has no range yet")
	}
	for _, kind := range gemeinde.DocumentKinds {
		assert.Equal(t, "fee_notice", kind.DocumentKind, "a Gemeinde issues a fee notice unless it chooses otherwise")
	}
	assert.True(t, gemeinde.LegalRemedyMissing)
	assert.Equal(t, 2, gemeinde.DirectDebitFamilies)
	assert.Equal(t, 1, gemeinde.FamiliesWithoutMandate, "Noah's family still needs a mandate for the Gemeinde")

	careContract(t, f.db, f.office.organization, north, "Mia", careBillingDay().String(), sjrServices()...)
	again, second := measure()
	assert.Equal(t, 3, again.Issuers[0].DirectDebitFamilies)
	assert.Len(t, second.Statements, len(first.Statements), "the state reads the same statements for any number of families")
	querybudgets.AssertQueryBudget(t, "api.traeger.required_details_issuers", first)
}

// TestGemeindeCollectsItsInstallmentsInAFileOfItsOwn (ADR 0322 point 8):
// the installments of the Gemeinde's notices never go into the Träger's
// file, where the Träger's account would receive them; the Gemeinde's file
// collects them with its creditor identifier into its account.
func TestGemeindeCollectsItsInstallmentsInAFileOfItsOwn(t *testing.T) {
	t.Parallel()
	f := sepaDebitFixture(t, "Träger Lastschrift je Stelle")
	north, south := f.office.schools[0], f.office.schools[1]
	storeBillingGemeinde(t, f.db, f.office.organization, north)
	rec := putCarePriceList(t, f.traeger, f.office.token, carePriceList(south, sepaDebitMonth, 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, numberRangesPath+"/care",
		map[string]any{"pattern": "GH-{JJJJ}-{NNN}", "issuer_key": gemeindeCreditorID})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	mia := careContract(t, f.db, f.office.organization, north, "Mia", sepaDebitMonth, sjrServices()...)
	assert.Equal(t, gemeindeCreditorID, createMandate(t, f, mandateBody(mia, "GH-JB-MIA")).CreditorID)
	noah := careContract(t, f.db, f.office.organization, south, "Noah", sepaDebitMonth, sjrServices()...)
	createMandate(t, f, mandateBody(noah, "SJR-JB-NOAH"))
	writeLegalRemedy(t, f.db, f.office.organization)
	notices := f.startNoticeRun(t, "2029-10-01", "2029-09-24")
	f.releaseNoticeRun(t, f.noticeRun(t, int64(notices.ID)))

	type fileBody struct {
		sepaDebitRunBody
		Issuer *struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		} `json:"issuer"`
		Issuers []struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		} `json:"issuers"`
	}
	installments := sepaDebitsPath + "/notice-months/202910"
	read := func(query string) fileBody {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, installments+query, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.NotContains(t, rec.Body.String(), "DE02120300000000202051", "the Gemeinde's account only masked")
		return decodeSchoolPortalData[fileBody](t, rec.Body.Bytes())
	}
	download := func(query string) string {
		req := httptest.NewRequest(http.MethodGet, installments+"/file"+query, nil)
		req.Header.Set("Authorization", "Bearer "+f.office.token)
		out := httptest.NewRecorder()
		f.traeger.ServeHTTP(out, req)
		require.Equal(t, http.StatusOK, out.Code, out.Body.String())
		return out.Body.String()
	}

	traeger := read("")
	require.Len(t, traeger.Debits, 1, "the Träger's file holds Noah's installment only")
	assert.Empty(t, traeger.Left)
	assert.Equal(t, sepaCreditorID, traeger.CreditorID)
	require.Len(t, traeger.Issuers, 1)
	assert.Equal(t, gemeindeCreditorID, traeger.Issuers[0].Key)
	assert.Equal(t, "Gemeinde Hardt", traeger.Issuers[0].Name)
	assert.NotContains(t, download(""), "<MndtId>GH-JB-MIA</MndtId>")

	own := read("?issuer=" + gemeindeCreditorID)
	require.Len(t, own.Debits, 1, "the Gemeinde's file holds Mia's installment")
	assert.Equal(t, gemeindeCreditorID, own.CreditorID)
	assert.Equal(t, "Gemeindekasse Hardt", own.CreditorName)
	require.NotNil(t, own.Issuer)
	assert.Equal(t, "Gemeinde Hardt", own.Issuer.Name)
	file := download("?issuer=" + gemeindeCreditorID)
	for _, want := range []string{"<MndtId>GH-JB-MIA</MndtId>", "<Id>" + gemeindeCreditorID + "</Id>", "<IBAN>DE02120300000000202051</IBAN>"} {
		assert.Contains(t, file, want)
	}
	assert.NotContains(t, file, "<MndtId>SJR-JB-NOAH</MndtId>")
	assert.NotContains(t, file, "<IBAN>"+sepaTraegerIBAN+"</IBAN>", "the Träger's account receives nothing of the Gemeinde")

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, installments+"/submission?issuer="+gemeindeCreditorID,
		map[string]any{"message_id": own.MessageID})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Empty(t, read("?issuer="+gemeindeCreditorID).Debits, "the Gemeinde's installment is collected once")
	assert.Len(t, read("").Debits, 1, "the Träger's file is still open")
}

// TestABodyNeverBillsWithTheTraegersCreditor (ADR 0322 point 10): a body
// whose creditor identifier is the Träger's holds every release back and
// its checklist says so; the Träger cannot take a body's identifier either.
func TestABodyNeverBillsWithTheTraegersCreditor(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Gläubiger-ID der Stelle")
	north := f.office.schools[0]
	storeBillingGemeinde(t, f.db, f.office.organization, north)
	body := map[string]any{"creditor_id": gemeindeCreditorID, "prenotification_days": 3, "missing_mandate": "transfer"}
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, sepaCreditorPath, withVersion(body, creditorVersion(t, f.traeger, f.office.token)))
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.issuer_creditor_is_traegers")
	assert.Contains(t, rec.Body.String(), "Gemeinde Hardt")

	saveCreditor(t, f, map[string]any{"creditor_id": sepaCreditorID, "prenotification_days": 3, "missing_mandate": "transfer"})
	_, err := f.db.ExecContext(context.Background(), `UPDATE platform.school_responsible_parties SET creditor_id = ? WHERE school_id = ?`,
		sepaCreditorID, north)
	require.NoError(t, err)
	status := readIssuerStatus(t, f)
	require.Len(t, status.Issuers, 1)
	assert.True(t, status.Issuers[0].CreditorIsTraegers)

	rec = putCarePriceList(t, f.traeger, f.office.token, carePriceList(north, "2029-09-01", 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	careContract(t, f.db, f.office.organization, north, "Lia", careMonth, sjrServices()...)
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, numberRangesPath+"/care",
		map[string]any{"pattern": "GH-{JJJJ}-{NNN}", "issuer_key": sepaCreditorID})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	writeLegalRemedy(t, f.db, f.office.organization)
	run := f.startRun(t, careMonth)
	preview := f.run(t, int64(run.ID))
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), "/release"), careRelease(preview))
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.issuer_creditor_is_traegers")
}
