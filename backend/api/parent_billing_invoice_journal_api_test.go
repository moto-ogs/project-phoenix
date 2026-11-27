// Router-level tests for the Rechnungsausgangsbuch (#4819): every issued
// document across runs in one list, its filters, the gaps of a number
// range, the right "Abrechnung", the Träger boundary, the trail of every
// run a page shows and the export.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

const invoiceJournalPath = "/traeger/invoice-journal"

type journalDocumentBody struct {
	Key                string `json:"key"`
	Number             string `json:"number"`
	IssuedOn           string `json:"issued_on"`
	DocumentType       string `json:"document_type"`
	RecipientFirstName string `json:"recipient_first_name"`
	RecipientLastName  string `json:"recipient_last_name"`
	Issuer             struct {
		Key  string `json:"key"`
		Body string `json:"body"`
	} `json:"issuer"`
	Service    string `json:"service"`
	NumberYear int    `json:"number_year"`
	Run        struct {
		Kind  string  `json:"kind"`
		ID    wireID  `json:"id"`
		Name  string  `json:"name"`
		Month *string `json:"month"`
		Year  int     `json:"year"`
	} `json:"run"`
	GrossCents int64 `json:"gross_cents"`
	TaxCents   int64 `json:"tax_cents"`
	NetCents   int64 `json:"net_cents"`
	Reference  *struct {
		Kind   string `json:"kind"`
		Number string `json:"number"`
	} `json:"reference"`
	Status       string   `json:"status"`
	OpenCents    int64    `json:"open_cents"`
	ChildNames   []string `json:"child_names"`
	DebtorNumber string   `json:"debtor_number"`
	FamilyID     *wireID  `json:"family_id"`
}

type journalBody struct {
	Documents []journalDocumentBody `json:"documents"`
	// TotalCount and HasMore come from the page of the answer.
	TotalCount int  `json:"-"`
	HasMore    bool `json:"-"`
	Totals     struct {
		GrossCents int64 `json:"gross_cents"`
		TaxCents   int64 `json:"tax_cents"`
		NetCents   int64 `json:"net_cents"`
		OpenCents  int64 `json:"open_cents"`
	} `json:"totals"`
	Gaps []struct {
		Service            string `json:"service"`
		Year               int    `json:"year"`
		FirstMissing       int64  `json:"first_missing"`
		MissingCount       int64  `json:"missing_count"`
		FirstMissingNumber string `json:"first_missing_number"`
		LastMissingNumber  string `json:"last_missing_number"`
		AfterNumber        string `json:"after_number"`
		BeforeNumber       string `json:"before_number"`
	} `json:"gaps"`
	NumberRanges []struct {
		Service       string `json:"service"`
		Year          int    `json:"year"`
		DocumentCount int    `json:"document_count"`
		FirstNumber   string `json:"first_number"`
		LastNumber    string `json:"last_number"`
	} `json:"number_ranges"`
	Runs []struct {
		Kind     string  `json:"kind"`
		ID       wireID  `json:"id"`
		IssuedOn *string `json:"issued_on"`
	} `json:"runs"`
}

// invoiceJournal reads a page of the journal with the query.
func invoiceJournal(t *testing.T, router http.Handler, token string, query url.Values) journalBody {
	t.Helper()
	path := invoiceJournalPath
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	rec := traegerJSON(t, router, token, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	journal := decodeSchoolPortalData[journalBody](t, rec.Body.Bytes())
	var envelope struct {
		Pagination struct {
			CurrentPage  int `json:"current_page"`
			PageSize     int `json:"page_size"`
			TotalRecords int `json:"total_records"`
		} `json:"pagination"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	require.Positive(t, envelope.Pagination.PageSize, "the journal answers as a page: %s", rec.Body.String())
	journal.TotalCount = envelope.Pagination.TotalRecords
	journal.HasMore = envelope.Pagination.CurrentPage*envelope.Pagination.PageSize < envelope.Pagination.TotalRecords
	return journal
}

// journalReads counts the entries the journal left in the trail of a
// holiday run.
func journalReads(t *testing.T, f reviewFixture, runID int64) int {
	t.Helper()
	var reads int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM parent_billing.run_events
		WHERE run_id = ? AND action = 'read' AND details->>'view' = 'journal'`, runID).Scan(context.Background(), &reads))
	return reads
}

func journalNumbers(journal journalBody) []string {
	numbers := make([]string, len(journal.Documents))
	for i, document := range journal.Documents {
		numbers[i] = document.Number
	}
	return numbers
}

func TestInvoiceJournalListsEveryIssuedDocumentAcrossRunsByNumber(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Ausgangsbuch")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)

	// A calculated run has no number yet: the journal stays empty.
	for _, id := range []int64{f.siblings, f.again} {
		require.Equal(t, http.StatusOK, f.act(t, id, "confirm").Code)
	}
	setNumberRange(t, f, billing, "FE-{NNNN}")
	draft := billingRun(t, f, billing, int64(startBillingRun(t, f, billing, int64(f.period.ID)).ID))
	empty := invoiceJournal(t, f.traeger, billing, nil)
	assert.Empty(t, empty.Documents, "a draft without a number is no document of the journal")
	assert.Zero(t, empty.TotalCount)
	assert.Empty(t, empty.NumberRanges)

	rec := traegerJSON(t, f.traeger, billing, http.MethodPost, billingRunPath(int64(draft.ID), "/release"), releaseBody(draft))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	released := correctedRun(t, f, billing, int64(draft.ID))
	first, second := documentByNumber(t, released, "FE-0001"), documentByNumber(t, released, "FE-0002")
	child := second.Children[0]
	rec = traegerJSON(t, f.traeger, billing, http.MethodPost, cancellationPath(int64(draft.ID), int64(first.ID)), map[string]any{"reason": "Anschrift falsch"})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, billing, http.MethodPost, creditPath(int64(draft.ID), int64(second.ID)),
		map[string]any{"child_id": fmt.Sprint(child.ChildID), "amount_cents": 500, "reason": "Erster Tag krank"})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	// Two numbers of the range are lost: the counter went on, no document
	// carries them.
	_, err := f.db.ExecContext(context.Background(), `UPDATE parent_billing.number_range_counters SET last_number = last_number + 2
		WHERE organization_id = ? AND service = 'holiday'`, f.office.organization)
	require.NoError(t, err)
	tail := invoiceJournal(t, f.traeger, billing, nil)
	require.Len(t, tail.Gaps, 1, "the counter went past the last document")
	assert.EqualValues(t, 5, tail.Gaps[0].FirstMissing, "the gap names its first running number")
	assert.EqualValues(t, 2, tail.Gaps[0].MissingCount)
	assert.Equal(t, "FE-0004", tail.Gaps[0].AfterNumber)
	assert.Empty(t, tail.Gaps[0].BeforeNumber)

	secondRun := releaseSecondPeriodFor(t, f, billing, "neu.familie@example.org")
	journal := invoiceJournal(t, f.traeger, billing, nil)
	require.Equal(t, 5, journal.TotalCount)
	assert.False(t, journal.HasMore)
	assert.ElementsMatch(t, []string{"FE-0001", "FE-0002", "FE-0003", "FE-0004", "FE-0007"}, journalNumbers(journal))
	byNumber := map[string]journalDocumentBody{}
	var gross int64
	for _, document := range journal.Documents {
		byNumber[document.Number] = document
		gross += document.GrossCents
		assert.Zero(t, document.TaxCents, document.Number)
		assert.Equal(t, document.GrossCents, document.NetCents, document.Number)
		assert.Equal(t, "holiday", document.Service)
		assert.Equal(t, "traeger", document.Issuer.Body, "the Träger issues without a body of its own")
		assert.Empty(t, document.Issuer.Key)
		assert.NotEmpty(t, document.RecipientLastName, document.Number)
		assert.NotEmpty(t, document.Run.Name, document.Number)
	}
	assert.Equal(t, gross, journal.Totals.GrossCents, "the sums cover every document of the filter")
	assert.Equal(t, gross, journal.Totals.NetCents)
	assert.Zero(t, journal.Totals.TaxCents)
	assert.Equal(t, "confirmation", byNumber["FE-0001"].DocumentType, "an invoice carries the kind its release froze")
	assert.Nil(t, byNumber["FE-0001"].Reference)
	cancellation, credit := byNumber["FE-0003"], byNumber["FE-0004"]
	assert.Equal(t, "cancellation", cancellation.DocumentType)
	assert.Equal(t, -first.TotalCents, cancellation.GrossCents, "a cancellation takes its invoice back")
	require.NotNil(t, cancellation.Reference)
	assert.Equal(t, "cancels", cancellation.Reference.Kind)
	assert.Equal(t, "FE-0001", cancellation.Reference.Number)
	assert.Equal(t, "credit", credit.DocumentType)
	assert.EqualValues(t, -500, credit.GrossCents)
	require.NotNil(t, credit.Reference)
	assert.Equal(t, "credits", credit.Reference.Kind)
	assert.Equal(t, "FE-0002", credit.Reference.Number)
	assert.EqualValues(t, secondRun, byNumber["FE-0007"].Run.ID, "the journal reaches across runs")

	// #8138: an invoice carries its state and what it still asks for, as
	// its family shows them; a correction asks for nothing of its own.
	assert.Equal(t, "cancelled", byNumber["FE-0001"].Status)
	assert.Zero(t, byNumber["FE-0001"].OpenCents, "a cancelled invoice asks for nothing")
	assert.Equal(t, "partly_credited", byNumber["FE-0002"].Status)
	assert.Equal(t, second.TotalCents-500, byNumber["FE-0002"].OpenCents, "a credit lowers what its invoice asks for")
	assert.Equal(t, "open", byNumber["FE-0007"].Status)
	assert.Equal(t, byNumber["FE-0007"].GrossCents, byNumber["FE-0007"].OpenCents)
	assert.Empty(t, cancellation.Status)
	assert.Empty(t, credit.Status)
	assert.Zero(t, credit.OpenCents)
	assert.Equal(t, byNumber["FE-0002"].OpenCents+byNumber["FE-0007"].OpenCents, journal.Totals.OpenCents,
		"the open sum covers every invoice of the filter")
	require.NotEmpty(t, byNumber["FE-0002"].ChildNames, "a document names the children it bills")
	require.NotNil(t, byNumber["FE-0001"].FamilyID)
	require.NotNil(t, cancellation.FamilyID)
	assert.Equal(t, *byNumber["FE-0001"].FamilyID, *cancellation.FamilyID, "a correction opens the family of its invoice")
	rec = traegerJSON(t, f.traeger, billing, http.MethodGet, fmt.Sprintf("/traeger/billing-families/%d", int64(*credit.FamilyID)), nil)
	require.Equal(t, http.StatusOK, rec.Code, "the family of a document opens: %s", rec.Body.String())
	ofState := invoiceJournal(t, f.traeger, billing, url.Values{"status": {"partly_credited"}})
	assert.Equal(t, []string{"FE-0002"}, journalNumbers(ofState))
	assert.Equal(t, byNumber["FE-0002"].OpenCents, ofState.Totals.OpenCents)
	assert.Contains(t, journalNumbers(invoiceJournal(t, f.traeger, billing, url.Values{"search": {strings.ToUpper(byNumber["FE-0002"].ChildNames[0])}})),
		"FE-0002", "the search finds a document by a child it bills")
	// A column orders every document of the filter in the database.
	assert.Equal(t, []string{"FE-0001", "FE-0002", "FE-0003", "FE-0004", "FE-0007"},
		journalNumbers(invoiceJournal(t, f.traeger, billing, url.Values{"sort": {"number"}})))
	assert.Equal(t, []string{"FE-0007", "FE-0004", "FE-0003", "FE-0002", "FE-0001"},
		journalNumbers(invoiceJournal(t, f.traeger, billing, url.Values{"sort": {"number"}, "order": {"desc"}})))
	for _, order := range []string{"asc", "desc"} {
		for column, value := range map[string]func(journalDocumentBody) int64{
			"gross": func(d journalDocumentBody) int64 { return d.GrossCents },
			"open":  func(d journalDocumentBody) int64 { return d.OpenCents },
		} {
			sorted := invoiceJournal(t, f.traeger, billing, url.Values{"sort": {column}, "order": {order}})
			require.Len(t, sorted.Documents, 5, column)
			values := make([]int64, len(sorted.Documents))
			for i, document := range sorted.Documents {
				values[i] = value(document)
			}
			if order == "asc" {
				assert.IsNonDecreasing(t, values, "%s %s", column, order)
			} else {
				assert.IsNonIncreasing(t, values, "%s %s", column, order)
			}
		}
	}
	byRecipient := invoiceJournal(t, f.traeger, billing, url.Values{"sort": {"recipient"}})
	names := make([]string, len(byRecipient.Documents))
	for i, document := range byRecipient.Documents {
		names[i] = document.RecipientLastName
	}
	assert.IsNonDecreasing(t, names)
	assert.Len(t, invoiceJournal(t, f.traeger, billing, url.Values{"sort": {"issued"}, "order": {"desc"}}).Documents, 5)
	assert.Equal(t, "holiday", byNumber["FE-0007"].Run.Kind)
	require.Len(t, journal.NumberRanges, 1)
	assert.Equal(t, 5, journal.NumberRanges[0].DocumentCount)
	assert.Equal(t, "FE-0001", journal.NumberRanges[0].FirstNumber)
	assert.Equal(t, "FE-0007", journal.NumberRanges[0].LastNumber)
	assert.Len(t, journal.Runs, 2)
	require.NotNil(t, journal.Runs[0].IssuedOn, "a run of the filter names its issue day")

	require.Len(t, journal.Gaps, 1, "the lost numbers now lie between two documents")
	assert.EqualValues(t, 5, journal.Gaps[0].FirstMissing)
	assert.Equal(t, "FE-0005", journal.Gaps[0].FirstMissingNumber, "the gap names the missing numbers as documents would carry them")
	assert.Equal(t, "FE-0006", journal.Gaps[0].LastMissingNumber)
	assert.EqualValues(t, 2, journal.Gaps[0].MissingCount)
	assert.Equal(t, "FE-0004", journal.Gaps[0].AfterNumber)
	assert.Equal(t, "FE-0007", journal.Gaps[0].BeforeNumber)

	// The filters narrow the list and its sums, never the gaps.
	only := invoiceJournal(t, f.traeger, billing, url.Values{"document_type": {"cancellation"}})
	assert.Equal(t, []string{"FE-0003"}, journalNumbers(only))
	assert.Equal(t, cancellation.GrossCents, only.Totals.GrossCents)
	assert.Len(t, only.Gaps, 1, "a filter on the document type hides no gap")
	assert.Len(t, only.Runs, 2, "the filters keep every run to choose from")
	ofRun := invoiceJournal(t, f.traeger, billing, url.Values{"run_kind": {"holiday"}, "run_id": {fmt.Sprint(secondRun)}})
	assert.Equal(t, []string{"FE-0007"}, journalNumbers(ofRun))
	assert.ElementsMatch(t, []string{"FE-0002", "FE-0004"}, journalNumbers(invoiceJournal(t, f.traeger, billing, url.Values{"search": {"fe-0002"}})),
		"a number finds its document and what refers to it")
	byName := invoiceJournal(t, f.traeger, billing, url.Values{"search": {strings.ToUpper(cancellation.RecipientLastName)}})
	assert.Contains(t, journalNumbers(byName), "FE-0003", "the search finds a recipient by name")
	issued := byNumber["FE-0001"].IssuedOn
	assert.Equal(t, 5, invoiceJournal(t, f.traeger, billing, url.Values{"from": {issued}, "to": {issued}}).TotalCount)
	assert.Zero(t, invoiceJournal(t, f.traeger, billing, url.Values{"to": {"2000-01-01"}}).TotalCount)
	ofRange := invoiceJournal(t, f.traeger, billing, url.Values{"issuer": {"traeger"}, "service": {"holiday"}, "year": {"0"}})
	assert.Equal(t, 5, ofRange.TotalCount)
	assert.Equal(t, []string{"FE-0007", "FE-0004", "FE-0003", "FE-0002", "FE-0001"}, journalNumbers(ofRange),
		"a number range is read by number, the highest first")
	otherRange := invoiceJournal(t, f.traeger, billing, url.Values{"service": {"care"}})
	assert.Zero(t, otherRange.TotalCount)
	assert.Len(t, otherRange.Gaps, 1, "a gap stays in view under every filter")
	assert.Zero(t, invoiceJournal(t, f.traeger, billing, url.Values{"issuer": {"DE98ZZZ09999999999"}}).TotalCount)
	for _, query := range []string{"from=gestern", "to=2026-13-01", "from=2026-02-01&to=2026-01-01", "service=mensa", "document_type=brief",
		"run_kind=ferien", "run_id=5", "run_kind=holiday", "year=-1", "page=0", "status=bezahlt", "sort=email", "sort=number&order=up", "search=" + strings.Repeat("a", 101)} {
		rec = traegerJSON(t, f.traeger, billing, http.MethodGet, invoiceJournalPath+"?"+query, nil)
		assert.Equal(t, http.StatusBadRequest, rec.Code, "%s: %s", query, rec.Body.String())
	}

	// A start value the Träger-Büro set explains the jump to it.
	_, err = f.db.ExecContext(context.Background(), `INSERT INTO parent_billing.number_range_starts
		(organization_id, issuer_key, service, year, next_number) VALUES (?, '', 'holiday', 0, 7)`, f.office.organization)
	require.NoError(t, err)
	assert.Empty(t, invoiceJournal(t, f.traeger, billing, nil).Gaps, "a jump to a start value is no gap")

	// Every page stands in the trail of each run it showed.
	var views []string
	require.NoError(t, f.db.NewRaw(`SELECT DISTINCT details->>'view' FROM parent_billing.run_events
		WHERE run_id = ? AND action = 'read' AND details->>'view' IS NOT NULL`, secondRun).Scan(context.Background(), &views))
	assert.Equal(t, []string{"journal"}, views)
	var shown []int64
	require.NoError(t, f.db.NewRaw(`SELECT jsonb_array_elements_text(details->'document_ids')::bigint FROM parent_billing.run_events
		WHERE run_id = ? AND action = 'read' AND details->>'view' = 'journal' ORDER BY id DESC LIMIT 1`, secondRun).
		Scan(context.Background(), &shown))
	assert.Len(t, shown, 1, "the trail names the documents of the run the reader saw")
	// A page that shows no document of a run leaves its trail alone, and a
	// download stands in the trail like the read of the page.
	firstBefore, secondBefore := journalReads(t, f, int64(draft.ID)), journalReads(t, f, secondRun)
	invoiceJournal(t, f.traeger, billing, url.Values{"run_kind": {"holiday"}, "run_id": {fmt.Sprint(secondRun)}})
	assert.Equal(t, firstBefore, journalReads(t, f, int64(draft.ID)), "the first run shows no document on this page")
	assert.Equal(t, secondBefore+1, journalReads(t, f, secondRun))
	billingListCSV(t, f.traeger, billing, invoiceJournalPath+"/export?document_type=credit")
	assert.Equal(t, firstBefore+1, journalReads(t, f, int64(draft.ID)), "the file holds the credit of the first run")
	assert.Equal(t, secondBefore+1, journalReads(t, f, secondRun), "and no document of the second")

	// #4718: the file lists every document of the filter by number, then
	// the sums.
	lines := billingListCSV(t, f.traeger, billing, invoiceJournalPath+"/export")
	require.Len(t, lines, 7, "the header, five documents and the sums")
	assert.Equal(t, "Nummer;Ausgestellt am;Dokumentart;Stand;Empfänger;Kinder;Debitorennummer;Rechnungssteller;Nummernkreis;Lauf;Bezug;Netto (Euro);Steuer (Euro);Brutto (Euro);Offene Forderung (Euro)", lines[0])
	assert.Contains(t, lines[1], ";Storniert;", "the file names the state of an invoice")
	assert.Contains(t, lines[2], ";Teilgutschrift;")
	for i, number := range []string{"FE-0001", "FE-0002", "FE-0003", "FE-0004", "FE-0007"} {
		assert.True(t, strings.HasPrefix(lines[i+1], number+";"), "the file counts by number: %s", lines[i+1])
	}
	assert.Contains(t, lines[3], ";Storno;")
	assert.Contains(t, lines[3], ";Träger;Ferienbetreuung;")
	assert.Contains(t, lines[3], ";Storno zu FE-0001;")
	assert.True(t, strings.HasPrefix(lines[6], "Summe;"))
	lines = billingListCSV(t, f.traeger, billing, invoiceJournalPath+"/export?document_type=credit")
	require.Len(t, lines, 3, "the file follows the filter")
	assert.Contains(t, lines[1], ";Gutschrift zu FE-0002;")
	assertTraegerListFormats(t, f.traeger, billing, invoiceJournalPath+"/export", "rechnungsausgangsbuch")
}

func TestInvoiceJournalNeedsTheBillingRightAndStaysWithItsTraeger(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Ausgangsbuch Recht")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	foreign := newTraegerOffice(t, f.db, f.traeger, "Träger Ausgangsbuch Fremd", identityaccess.TraegerRoleBilling)
	run := releasedBillingRun(t, f, billing)

	for _, path := range []string{invoiceJournalPath, invoiceJournalPath + "/export"} {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, path, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, "GET %s without the right Abrechnung: %s", path, rec.Body.String())
	}
	// The Träger has a gap, so a leak of its number ranges would show.
	_, err := f.db.ExecContext(context.Background(), `UPDATE parent_billing.number_range_counters SET last_number = last_number + 1
		WHERE organization_id = ? AND service = 'holiday'`, f.office.organization)
	require.NoError(t, err)
	require.Len(t, invoiceJournal(t, f.traeger, billing, nil).Gaps, 1)
	other := invoiceJournal(t, f.traeger, foreign.token, nil)
	assert.Empty(t, other.Documents, "another Träger lists none of these documents")
	assert.Empty(t, other.Gaps, "nor a gap of its number ranges")
	assert.Empty(t, other.NumberRanges)
	assert.Empty(t, other.Runs)
	assert.Len(t, billingListCSV(t, f.traeger, foreign.token, invoiceJournalPath+"/export"), 1, "the file of another Träger holds no document")
	var reads int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM parent_billing.run_events WHERE run_id = ? AND details->>'view' = 'journal'`, run.ID).
		Scan(context.Background(), &reads))
	assert.Equal(t, 1, reads, "only the read of the Träger itself stands in the trail")
	assert.Len(t, invoiceJournal(t, f.traeger, billing, nil).Documents, len(run.Documents))
}

func TestInvoiceJournalCountsMonthlyInvoicesAndTheirCancellationsInOneRange(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Ausgangsbuch Monat")
	run, contracts := releasedCareRun(t, f, "Mia", "Lea")
	mia := invoiceOfContract(t, run, contracts["Mia"])
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), fmt.Sprintf("/invoices/%d/cancellation", mia.ID)),
		map[string]any{"reason": "Falscher Vertrag"})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	journal := invoiceJournal(t, f.traeger, f.office.token, nil)
	require.Equal(t, 3, journal.TotalCount, "both invoices and the Storno")
	require.Len(t, journal.NumberRanges, 1, "the Storno counts in the range of the invoices")
	assert.Equal(t, "care", journal.NumberRanges[0].Service)
	assert.Empty(t, journal.Gaps)
	var cancellation journalDocumentBody
	for _, document := range journal.Documents {
		assert.Equal(t, "care", document.Run.Kind)
		assert.EqualValues(t, run.ID, document.Run.ID)
		require.NotNil(t, document.Run.Month)
		assert.Equal(t, careMonth, *document.Run.Month)
		// #8138: a monthly invoice bills one child and opens its family.
		assert.Len(t, document.ChildNames, 1, document.Number)
		require.NotNil(t, document.FamilyID, document.Number)
		switch {
		case document.DocumentType == "cancellation":
			cancellation = document
			assert.Empty(t, document.Status)
		case document.Number == mia.Number:
			assert.Equal(t, "cancelled", document.Status)
			assert.Zero(t, document.OpenCents)
		default:
			assert.Equal(t, "open", document.Status)
			assert.Equal(t, document.GrossCents, document.OpenCents)
			assert.Equal(t, document.OpenCents, journal.Totals.OpenCents, "only the invoice not taken back still asks")
		}
	}
	assert.Equal(t, 2, invoiceJournal(t, f.traeger, f.office.token, url.Values{"search": {"mia"}}).TotalCount,
		"the child finds its invoice and the Storno")
	require.NotNil(t, cancellation.Reference, "the Storno names its invoice")
	assert.Equal(t, mia.Number, cancellation.Reference.Number)
	assert.Equal(t, "cancels", cancellation.Reference.Kind)
	assert.Negative(t, cancellation.GrossCents)
	assert.NotEmpty(t, cancellation.RecipientLastName, "the Storno has the recipient of its invoice")
	assert.Equal(t, 1, invoiceJournal(t, f.traeger, f.office.token, url.Values{"document_type": {"cancellation"}}).TotalCount)
	assert.Equal(t, 3, invoiceJournal(t, f.traeger, f.office.token, url.Values{"run_kind": {"care"}, "run_id": {fmt.Sprint(run.ID)}}).TotalCount)
	assert.Zero(t, invoiceJournal(t, f.traeger, f.office.token, url.Values{"run_kind": {"holiday"}, "run_id": {fmt.Sprint(run.ID)}}).TotalCount,
		"a run is named by its kind and its ID")

	var details []string
	require.NoError(t, f.db.NewRaw(`SELECT details::text FROM parent_billing.care_run_events
		WHERE run_id = ? AND action = 'read' AND details->>'view' = 'journal' ORDER BY id LIMIT 1`, run.ID).Scan(context.Background(), &details))
	require.Len(t, details, 1, "the read stands in the trail of the monthly run")
	assert.Contains(t, details[0], `"invoice_ids"`)
	assert.Contains(t, details[0], `"cancellation_ids"`)
	lines := billingListCSV(t, f.traeger, f.office.token, invoiceJournalPath+"/export")
	require.Len(t, lines, 5)
	assert.Contains(t, strings.Join(lines, "\n"), ";Monatsbeiträge 01/2030;")
}

func TestInvoiceJournalListsJahresbescheideAsFeeNotices(t *testing.T) {
	t.Parallel()
	f, _, run, _ := releasedNoticeRun(t, "Träger Ausgangsbuch Bescheid")
	journal := invoiceJournal(t, f.traeger, f.office.token, nil)
	require.Len(t, journal.Documents, 1)
	notice := journal.Documents[0]
	assert.Equal(t, "fee_notice", notice.DocumentType)
	assert.Equal(t, "care_notice", notice.Run.Kind)
	assert.EqualValues(t, run.ID, notice.Run.ID)
	assert.Equal(t, 2030, notice.Run.Year)
	assert.Equal(t, "care", notice.Service, "a Jahresbescheid counts in the range of the care")
	assert.Equal(t, run.Notices[0].Number, notice.Number)
	assert.NotEmpty(t, notice.RecipientLastName)
	assert.Positive(t, notice.GrossCents)
	// #8138: the state and the open amount follow the families (#4691),
	// which count invoices only: a Jahresbescheid carries neither.
	assert.Empty(t, notice.Status)
	assert.Zero(t, notice.OpenCents)
	assert.Zero(t, journal.Totals.OpenCents)
	assert.Nil(t, notice.FamilyID)
	var reads int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM parent_billing.care_notice_run_events
		WHERE run_id = ? AND action = 'read' AND details->>'view' = 'journal'`, run.ID).Scan(context.Background(), &reads))
	assert.Equal(t, 1, reads, "the read stands in the trail of the run of the Jahresbescheide")
	lines := billingListCSV(t, f.traeger, f.office.token, invoiceJournalPath+"/export?run_kind=care_notice&run_id="+fmt.Sprint(run.ID))
	require.Len(t, lines, 3)
	assert.Contains(t, lines[1], ";Gebührenbescheid;")
	assert.Contains(t, lines[1], ";Jahresbescheide 2030;")
}

func TestInvoiceJournalQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Budget Ausgangsbuch")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	list := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		req := httptest.NewRequest(http.MethodGet, invoiceJournalPath, nil)
		req.Header.Set("Authorization", "Bearer "+billing)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, f.traeger, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Queries())
	}
	releasedBillingRun(t, f, billing)
	journal := list()
	releaseSecondPeriodFor(t, f, billing, "neu.familie@example.org")
	assert.Len(t, list().Statements, len(journal.Statements), "the journal reads and records the same statements for any number of documents and runs")
	querybudgets.AssertQueryBudget(t, "api.traeger.invoice_journal", journal)
}
