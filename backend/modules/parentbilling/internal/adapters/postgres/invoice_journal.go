package postgres

import (
	"context"
	"fmt"
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Rechnungsausgangsbuch of a Träger (#4819): every document with a
// number, from the four tables the releases write. A holiday document keeps
// its own issuer and number range; the monthly invoices, their
// cancellations and the Jahresbescheide share the range of the care. A
// cancellation of a monthly invoice has the recipient and the issuer of its
// invoice.

// journalRowsSQL lists every issued document of the Träger ?0 in one shape.
// source and id name a document across the tables; service and number_year
// name its number range together with issuer_key.
const journalRowsSQL = `
	SELECT 'holiday'::text AS source, document.id, 'holiday'::text AS run_kind, document.run_id, run.period_name AS run_name,
		NULL::date AS run_month, NULL::int AS run_year, document.service::text AS service, document.issuer_key::text AS issuer_key,
		COALESCE(document.issuer->>'body', '') AS issuer_body, COALESCE(document.issuer->>'name', '') AS issuer_name,
		document.number::text AS number, document.number_year::int AS number_year, document.number_sequence, document.issued_on,
		CASE document.kind WHEN 'invoice' THEN document.document_kind ELSE document.kind END::text AS document_type,
		document.recipient_first_name, document.recipient_last_name, document.total_cents,
		COALESCE(reference.number, '')::text AS reference_number,
		CASE WHEN document.reference_document_id IS NULL THEN '' WHEN document.kind = 'invoice' THEN 'replaces'
			WHEN document.kind = 'credit' THEN 'credits' ELSE 'cancels' END AS reference_kind
	FROM parent_billing.documents AS document
	JOIN parent_billing.runs AS run ON run.organization_id = document.organization_id AND run.id = document.run_id
	LEFT JOIN parent_billing.documents AS reference
		ON reference.organization_id = document.organization_id AND reference.id = document.reference_document_id
	WHERE document.organization_id = ?0
	UNION ALL
	SELECT 'care_invoice', invoice.id, 'care', invoice.run_id, '', run.billing_month, NULL, 'care', invoice.issuer_key,
		COALESCE(invoice.issuer->>'body', ''), COALESCE(invoice.issuer->>'name', ''),
		invoice.number, invoice.number_year, invoice.number_sequence, invoice.issued_on, invoice.document_kind,
		invoice.recipient_first_name, invoice.recipient_last_name, invoice.total_cents, COALESCE(replaced.number, ''),
		CASE WHEN invoice.replaces_invoice_id IS NULL THEN '' ELSE 'replaces' END
	FROM parent_billing.care_invoices AS invoice
	JOIN parent_billing.care_runs AS run ON run.organization_id = invoice.organization_id AND run.id = invoice.run_id
	LEFT JOIN parent_billing.care_invoices AS replaced
		ON replaced.organization_id = invoice.organization_id AND replaced.id = invoice.replaces_invoice_id
	WHERE invoice.organization_id = ?0
	UNION ALL
	SELECT 'care_cancellation', cancellation.id, 'care', cancellation.run_id, '', run.billing_month, NULL, 'care', cancellation.issuer_key,
		COALESCE(invoice.issuer->>'body', ''), COALESCE(invoice.issuer->>'name', ''),
		cancellation.number, cancellation.number_year, cancellation.number_sequence, cancellation.issued_on, 'cancellation',
		invoice.recipient_first_name, invoice.recipient_last_name, cancellation.total_cents, invoice.number, 'cancels'
	FROM parent_billing.care_invoice_cancellations AS cancellation
	JOIN parent_billing.care_invoices AS invoice
		ON invoice.organization_id = cancellation.organization_id AND invoice.id = cancellation.invoice_id
	JOIN parent_billing.care_runs AS run ON run.organization_id = cancellation.organization_id AND run.id = cancellation.run_id
	WHERE cancellation.organization_id = ?0
	UNION ALL
	SELECT 'care_notice', notice.id, 'care_notice', notice.run_id, '', NULL, run.billing_year, 'care', notice.issuer_key,
		COALESCE(notice.issuer->>'body', ''), COALESCE(notice.issuer->>'name', ''),
		notice.number, notice.number_year, notice.number_sequence, notice.issued_on, 'fee_notice',
		COALESCE(notice.recipient->>'first_name', ''), COALESCE(notice.recipient->>'last_name', ''), notice.total_cents,
		COALESCE(amended.number, ''), CASE WHEN notice.amends_notice_id IS NULL THEN '' ELSE 'amends' END
	FROM parent_billing.care_notices AS notice
	JOIN parent_billing.care_notice_runs AS run ON run.organization_id = notice.organization_id AND run.id = notice.run_id
	LEFT JOIN parent_billing.care_notices AS amended
		ON amended.organization_id = notice.organization_id AND amended.id = notice.amends_notice_id
	WHERE notice.organization_id = ?0`

// The two orders of the journal.
const (
	journalNewestFirst = `issued_on DESC, number_year DESC, service, issuer_key, number_sequence DESC`
	// A number range is read by number: its documents stand in the order
	// they were numbered, whatever day each one names as its issue day.
	journalByNumberDown = `number_year DESC, service, issuer_key, number_sequence DESC`
	journalByNumber     = `number_year, issuer_key, service, number_sequence`
)

// journalHeadSQL and journalTailSQL read one page of the journal, the sums
// of every document that passes the filter, every gap of the number ranges
// whatever the filter, and the number ranges and runs of the Träger, and
// record the read of the page in the trail of each of its runs, all in one
// statement. The order stands between its head and its tail.
//
// A gap is a step between two neighbouring numbers of a range that is wider
// than one, from zero for the first document, unless the document after it
// carries a start value the Träger-Büro set (#7358). The counter of a range
// that went on past its last document leaves a gap at the end.
const journalHeadSQL = `WITH journal AS MATERIALIZED (` + journalRowsSQL + `),
 filtered AS MATERIALIZED (
	SELECT journal.*, row_number() OVER (ORDER BY `

const journalTailSQL = `, source, id) AS position
	FROM journal
	WHERE (?1::date IS NULL OR issued_on >= ?1::date) AND (?2::date IS NULL OR issued_on <= ?2::date)
		AND (?3 OR issuer_key = ?4) AND (?5 = '' OR service = ?5) AND (?6 OR number_year = ?7)
		AND (?8 = '' OR document_type = ?8) AND (?9 = '' OR run_kind = ?9) AND (?10 = 0 OR run_id = ?10)
		AND (?11 = '' OR position(lower(?11) IN lower(number)) > 0 OR position(lower(?11) IN lower(reference_number)) > 0
			OR position(lower(?11) IN lower(recipient_first_name || ' ' || recipient_last_name)) > 0)),
 page AS MATERIALIZED (
	SELECT * FROM filtered WHERE position > ?13 AND (?12 = 0 OR position <= ?13 + ?12)),
 holiday_reads AS (
	INSERT INTO parent_billing.run_events (organization_id, run_id, action, actor_account_id, details)
	SELECT ?0, run_id, 'read', ?14, jsonb_build_object('view', 'journal', 'document_ids', jsonb_agg(id ORDER BY id))
	FROM page WHERE run_kind = 'holiday' GROUP BY run_id),
 care_reads AS (
	INSERT INTO parent_billing.care_run_events (organization_id, run_id, action, actor_account_id, details)
	SELECT ?0, run_id, 'read', ?14, jsonb_build_object('view', 'journal',
		'invoice_ids', COALESCE(jsonb_agg(id ORDER BY id) FILTER (WHERE source = 'care_invoice'), '[]'::jsonb),
		'cancellation_ids', COALESCE(jsonb_agg(id ORDER BY id) FILTER (WHERE source = 'care_cancellation'), '[]'::jsonb))
	FROM page WHERE run_kind = 'care' GROUP BY run_id),
 notice_reads AS (
	INSERT INTO parent_billing.care_notice_run_events (organization_id, run_id, action, actor_account_id, details)
	SELECT ?0, run_id, 'read', ?14, jsonb_build_object('view', 'journal', 'notice_ids', jsonb_agg(id ORDER BY id))
	FROM page WHERE run_kind = 'care_notice' GROUP BY run_id),
 ranges AS (
	SELECT issuer_key, service, number_year, max(issuer_body) AS issuer_body, max(issuer_name) AS issuer_name,
		count(*) AS document_count, max(number_sequence) AS last_sequence,
		(array_agg(number ORDER BY number_sequence))[1] AS first_number,
		(array_agg(number ORDER BY number_sequence DESC))[1] AS last_number
	FROM journal GROUP BY issuer_key, service, number_year),
 steps AS (
	SELECT issuer_key, service, number_year, number_sequence, number,
		COALESCE(lag(number_sequence) OVER range_order, 0) AS previous_sequence,
		COALESCE(lag(number) OVER range_order, '') AS previous_number
	FROM journal
	WINDOW range_order AS (PARTITION BY issuer_key, service, number_year ORDER BY number_sequence)),
 gaps AS (
	SELECT steps.issuer_key, steps.service, steps.number_year, steps.previous_sequence + 1 AS first_missing,
		steps.number_sequence - steps.previous_sequence - 1 AS missing_count,
		steps.previous_number AS after_number, steps.number AS before_number
	FROM steps
	WHERE steps.number_sequence > steps.previous_sequence + 1 AND NOT EXISTS (
		SELECT 1 FROM parent_billing.number_range_starts AS start
		WHERE start.organization_id = ?0 AND start.issuer_key = steps.issuer_key AND start.service = steps.service
			AND start.year = steps.number_year AND start.next_number = steps.number_sequence)
	UNION ALL
	SELECT ranges.issuer_key, ranges.service, ranges.number_year, ranges.last_sequence + 1,
		counter.last_number - ranges.last_sequence, ranges.last_number, ''
	FROM ranges
	JOIN parent_billing.number_range_counters AS counter
		ON counter.organization_id = ?0 AND counter.issuer_key = ranges.issuer_key AND counter.service = ranges.service
			AND counter.year = ranges.number_year
	WHERE counter.last_number > ranges.last_sequence),
 named_gaps AS (
	SELECT gaps.*, ranges.issuer_body, ranges.issuer_name
	FROM gaps JOIN ranges USING (issuer_key, service, number_year)),
 run_options AS (
	SELECT run_kind, run_id, max(run_name) AS run_name, max(run_month) AS run_month, max(run_year) AS run_year,
		max(issued_on) AS last_issued_on
	FROM journal GROUP BY run_kind, run_id)
 SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY position) FROM page), '[]'::jsonb) AS documents,
	(SELECT count(*) FROM filtered) AS total_count,
	COALESCE((SELECT sum(total_cents) FROM filtered), 0)::bigint AS gross_cents,
	COALESCE((SELECT jsonb_agg(to_jsonb(named_gaps) ORDER BY number_year DESC, service, issuer_name, issuer_key, first_missing)
		FROM named_gaps), '[]'::jsonb) AS gaps,
	COALESCE((SELECT jsonb_agg(to_jsonb(ranges) ORDER BY number_year DESC, service, issuer_name, issuer_key) FROM ranges), '[]'::jsonb)
		AS number_ranges,
	COALESCE((SELECT jsonb_agg(to_jsonb(run_options) ORDER BY last_issued_on DESC, run_kind, run_id DESC) FROM run_options), '[]'::jsonb)
		AS runs`

// The journal as a page, the newest document first, and as a file, every
// number range from its first number on.
const (
	journalPageSQL  = journalHeadSQL + journalNewestFirst + journalTailSQL
	journalRangeSQL = journalHeadSQL + journalByNumberDown + journalTailSQL
	journalFileSQL  = journalHeadSQL + journalByNumber + journalTailSQL
)

type journalDocumentRow struct {
	Source             string         `json:"source"`
	ID                 int64          `json:"id"`
	RunKind            string         `json:"run_kind"`
	RunID              int64          `json:"run_id"`
	RunName            string         `json:"run_name"`
	RunMonth           *calendar.Date `json:"run_month"`
	RunYear            *int           `json:"run_year"`
	Service            string         `json:"service"`
	IssuerKey          string         `json:"issuer_key"`
	IssuerBody         string         `json:"issuer_body"`
	IssuerName         string         `json:"issuer_name"`
	Number             string         `json:"number"`
	NumberYear         int            `json:"number_year"`
	IssuedOn           calendar.Date  `json:"issued_on"`
	DocumentType       string         `json:"document_type"`
	RecipientFirstName string         `json:"recipient_first_name"`
	RecipientLastName  string         `json:"recipient_last_name"`
	TotalCents         int64          `json:"total_cents"`
	ReferenceNumber    string         `json:"reference_number"`
	ReferenceKind      string         `json:"reference_kind"`
}

type journalRangeRow struct {
	IssuerKey     string `json:"issuer_key"`
	IssuerBody    string `json:"issuer_body"`
	IssuerName    string `json:"issuer_name"`
	Service       string `json:"service"`
	NumberYear    int    `json:"number_year"`
	DocumentCount int    `json:"document_count"`
	FirstNumber   string `json:"first_number"`
	LastNumber    string `json:"last_number"`
	FirstMissing  int64  `json:"first_missing"`
	MissingCount  int64  `json:"missing_count"`
	AfterNumber   string `json:"after_number"`
	BeforeNumber  string `json:"before_number"`
}

type journalRunRow struct {
	RunKind  string         `json:"run_kind"`
	RunID    int64          `json:"run_id"`
	RunName  string         `json:"run_name"`
	RunMonth *calendar.Date `json:"run_month"`
	RunYear  *int           `json:"run_year"`
	IssuedOn *calendar.Date `json:"last_issued_on"`
}

// journalIssuer is the issuer a row names: the Träger for the empty key.
func journalIssuer(key, body, name string) parentbilling.BillingIssuer {
	if key == "" {
		return parentbilling.TraegerIssuer()
	}
	return parentbilling.BillingIssuer{Key: key, Body: body, Name: name}
}

func journalRun(kind string, id int64, name string, month *calendar.Date, year *int) parentbilling.JournalRun {
	run := parentbilling.JournalRun{Kind: kind, ID: ident.ID(id), Name: name, Month: month}
	if year != nil {
		run.Year = *year
	}
	return run
}

func (row journalDocumentRow) document() parentbilling.JournalDocument {
	document := parentbilling.JournalDocument{
		Key: row.Source + "-" + strconv.FormatInt(row.ID, 10), Number: row.Number, IssuedOn: row.IssuedOn, DocumentType: row.DocumentType,
		RecipientFirstName: row.RecipientFirstName, RecipientLastName: row.RecipientLastName,
		Issuer:  journalIssuer(row.IssuerKey, row.IssuerBody, row.IssuerName),
		Service: row.Service, NumberYear: row.NumberYear,
		Run:        journalRun(row.RunKind, row.RunID, row.RunName, row.RunMonth, row.RunYear),
		GrossCents: row.TotalCents,
	}
	if row.ReferenceKind != "" {
		document.Reference = &parentbilling.JournalReference{Kind: row.ReferenceKind, Number: row.ReferenceNumber}
	}
	return document
}

// ReadInvoiceJournal reads the page of the journal the filter names and
// records its read in the trail of each run it shows, in one statement.
func (s *Store) ReadInvoiceJournal(ctx context.Context, organizationID, accountID int64, filter parentbilling.InvoiceJournalFilter,
) (parentbilling.InvoiceJournalPage, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return parentbilling.InvoiceJournalPage{}, err
	}
	var rows struct {
		Documents    []journalDocumentRow `bun:"documents,type:json"`
		TotalCount   int                  `bun:"total_count"`
		GrossCents   int64                `bun:"gross_cents"`
		Gaps         []journalRangeRow    `bun:"gaps,type:json"`
		NumberRanges []journalRangeRow    `bun:"number_ranges,type:json"`
		Runs         []journalRunRow      `bun:"runs,type:json"`
	}
	args := []any{organizationID, filter.From, filter.Until, filter.AnyIssuer, filter.Issuer, filter.Service, filter.AnyYear, filter.Year,
		filter.DocumentType, filter.RunKind, filter.RunID, filter.Search, 0, 0, accountRef(accountID)}
	query := db.NewRaw(journalFileSQL, args...)
	if filter.Page > 0 {
		args[12], args[13] = parentbilling.InvoiceJournalPageSize, (filter.Page-1)*parentbilling.InvoiceJournalPageSize
		query = db.NewRaw(journalPageSQL, args...)
		if filter.Service != "" {
			query = db.NewRaw(journalRangeSQL, args...)
		}
	}
	if err := query.Scan(ctx, &rows); err != nil {
		return parentbilling.InvoiceJournalPage{}, fmt.Errorf("read the invoice journal and record its read: %w", err)
	}
	page := parentbilling.InvoiceJournalPage{
		Documents: make([]parentbilling.JournalDocument, len(rows.Documents)), TotalCount: rows.TotalCount,
		Totals: parentbilling.JournalTotals{GrossCents: rows.GrossCents},
		Gaps:   make([]parentbilling.JournalNumberGap, len(rows.Gaps)), NumberRanges: make([]parentbilling.JournalNumberRange, len(rows.NumberRanges)),
		Runs: make([]parentbilling.JournalRun, len(rows.Runs)),
	}
	for i, row := range rows.Documents {
		page.Documents[i] = row.document()
	}
	for i, row := range rows.Gaps {
		page.Gaps[i] = parentbilling.JournalNumberGap{Issuer: journalIssuer(row.IssuerKey, row.IssuerBody, row.IssuerName),
			Service: row.Service, Year: row.NumberYear, FirstMissing: row.FirstMissing, MissingCount: row.MissingCount, AfterNumber: row.AfterNumber, BeforeNumber: row.BeforeNumber}
	}
	for i, row := range rows.NumberRanges {
		page.NumberRanges[i] = parentbilling.JournalNumberRange{Issuer: journalIssuer(row.IssuerKey, row.IssuerBody, row.IssuerName),
			Service: row.Service, Year: row.NumberYear, DocumentCount: row.DocumentCount, FirstNumber: row.FirstNumber, LastNumber: row.LastNumber}
	}
	for i, row := range rows.Runs {
		page.Runs[i] = journalRun(row.RunKind, row.RunID, row.RunName, row.RunMonth, row.RunYear)
		page.Runs[i].IssuedOn = row.IssuedOn
	}
	return page, nil
}
