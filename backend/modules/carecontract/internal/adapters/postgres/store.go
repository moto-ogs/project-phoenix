// Package postgres persists the Betreuungsvertrag of a Träger. Its tables
// carry organization_id and a Träger policy on app.current_org_id (ADR 0086
// section 5, ADR 0105): every statement here runs in the Träger transaction
// of the Träger it names, and names it once more in its own filter.
package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// Store reads the current version of a contract on the Berlin day of the
// owner's clock (ADR 0239).
type Store struct{ today func() calendar.Date }

var _ ports.Store = (*Store)(nil)

// NewStore builds the store on today, the composition's day clock. A store
// of a composition that reads no current version (the billing reads, the
// office's change decisions) may pass nil; its Contract and ListContracts
// then fail.
func NewStore(today func() calendar.Date) *Store { return &Store{today: today} }

// day is the day the current version is picked on.
func (s Store) day() (calendar.Date, error) {
	if s.today == nil {
		return "", errors.New("care contract postgres: the day clock is required to read the current version")
	}
	return s.today(), nil
}

// traegerDB returns the Träger transaction of organizationID. A school,
// administrative or foreign Träger transaction is refused.
func traegerDB(ctx context.Context, organizationID int64) (bun.IDB, error) {
	if organizationID <= 0 || tenant.TraegerTransactionFromContext(ctx) != organizationID {
		return nil, errors.New("care contract postgres: the Träger transaction of this Träger is required")
	}
	transaction, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return nil, errors.New("care contract postgres: transaction is required")
	}
	tx, ok := transaction.(bun.Tx)
	if !ok {
		return nil, fmt.Errorf("care contract postgres: unsupported transaction %T", transaction)
	}
	return tx, nil
}

type templateRow struct {
	ID                     int64     `bun:"id"`
	SchoolID               int64     `bun:"school_id"`
	CareOfferingID         int64     `bun:"care_offering_id"`
	TermKind               string    `bun:"term_kind"`
	TermMonths             *int      `bun:"term_months"`
	NoticeMonths           int       `bun:"notice_months"`
	NoticeTo               string    `bun:"notice_to"`
	SpecialTermination     bool      `bun:"special_termination"`
	SpecialTerminationNote string    `bun:"special_termination_note"`
	StatuteRequired        bool      `bun:"statute_required"`
	StatuteTitle           string    `bun:"statute_title"`
	StatuteURL             string    `bun:"statute_url"`
	ContractPartner        string    `bun:"contract_partner"`
	UpdatedAt              time.Time `bun:"updated_at"`
}

func (r templateRow) template() carecontract.ContractTemplate {
	return carecontract.ContractTemplate{ID: ident.ID(r.ID), UpdatedAt: r.UpdatedAt, TemplateInput: carecontract.TemplateInput{
		TermKind: r.TermKind, TermMonths: r.TermMonths, NoticeMonths: r.NoticeMonths, NoticeTo: r.NoticeTo,
		SpecialTermination: r.SpecialTermination, SpecialTerminationNote: r.SpecialTerminationNote,
		StatuteRequired: r.StatuteRequired, StatuteTitle: r.StatuteTitle, StatuteURL: r.StatuteURL,
		ContractPartner: r.ContractPartner,
	}}
}

const templateColumns = `id, school_id, care_offering_id, term_kind, term_months, notice_months, notice_to,
	special_termination, special_termination_note, statute_required, statute_title, statute_url,
	contract_partner, updated_at`

func (Store) Templates(ctx context.Context, organizationID int64) ([]ports.TemplateRow, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		templateRow
		Versions         []string `bun:"versions,array"`
		VersionsComplete bool     `bun:"versions_complete"`
	}
	// The trail holds the conditions texts of every saved version of a template
	// (ports.VersionsDetail). A save before they were recorded left an entry
	// without them: that template's history is incomplete. The Träger's
	// template entries are grouped by template once and joined, so the read
	// stays one pass over the trail however many templates there are.
	// Binds: ?0 the detail, ?1 the template action, ?2 the Träger.
	if err := db.NewRaw(`SELECT t.id, t.school_id, t.care_offering_id, t.term_kind, t.term_months,
			t.notice_months, t.notice_to, t.special_termination, t.special_termination_note,
			t.statute_required, t.statute_title, t.statute_url, t.contract_partner, t.updated_at,
			COALESCE(h.versions, '{}') AS versions, COALESCE(h.complete, false) AS versions_complete
		FROM care_contract.contract_templates AS t
		LEFT JOIN (SELECT e.details->>'template_id' AS template_id,
				COALESCE(array_agg(DISTINCT v.version ORDER BY v.version) FILTER (WHERE v.version IS NOT NULL), '{}') AS versions,
				bool_and(jsonb_typeof(e.details->?0) IS NOT DISTINCT FROM 'array') AS complete
			FROM care_contract.contract_events AS e
			LEFT JOIN LATERAL jsonb_array_elements_text(CASE jsonb_typeof(e.details->?0) WHEN 'array' THEN e.details->?0 ELSE '[]' END) AS v(version) ON true
			WHERE e.organization_id = ?2 AND e.contract_id IS NULL AND e.action = ?1
			GROUP BY e.details->>'template_id') AS h ON h.template_id = t.id::text
		WHERE t.organization_id = ?2 ORDER BY t.school_id, t.care_offering_id`,
		ports.VersionsDetail, ports.ActionTemplate, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: templates: %w", err)
	}
	result := make([]ports.TemplateRow, len(rows))
	for i, row := range rows {
		result[i] = ports.TemplateRow{SchoolID: row.SchoolID, OfferingID: row.CareOfferingID, Template: row.template(),
			Versions: row.Versions, VersionsComplete: row.VersionsComplete}
	}
	return result, nil
}

// LockTemplate serializes the saves of one offering's template: an advisory
// lock covers an offering without a template, the row lock the one with.
func (Store) LockTemplate(ctx context.Context, organizationID, schoolID, offeringID int64) (*carecontract.ContractTemplate, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if _, err := db.NewRaw(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`,
		fmt.Sprintf("care_contract.template:%d:%d:%d", organizationID, schoolID, offeringID)).Exec(ctx); err != nil {
		return nil, fmt.Errorf("care contract postgres: lock the template: %w", err)
	}
	var rows []templateRow
	if err := db.NewRaw(`SELECT `+templateColumns+` FROM care_contract.contract_templates
		WHERE organization_id = ? AND school_id = ? AND care_offering_id = ? FOR UPDATE`,
		organizationID, schoolID, offeringID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: lock the template: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	template := rows[0].template()
	return &template, nil
}

// UpsertTemplate replaces the offering's template, or with replace false
// only inserts one: a template another writer inserted since the caller read
// none (the catalog rollout takes no template lock) is then readstate.ErrChanged.
func (Store) UpsertTemplate(ctx context.Context, organizationID, accountID, schoolID, offeringID int64, input carecontract.TemplateInput, replace bool) (carecontract.ContractTemplate, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return carecontract.ContractTemplate{}, err
	}
	var row templateRow
	err = db.NewRaw(`INSERT INTO care_contract.contract_templates (organization_id, school_id, care_offering_id,
			term_kind, term_months, notice_months, notice_to, special_termination, special_termination_note,
			statute_required, statute_title, statute_url, contract_partner, updated_by_account_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (organization_id, school_id, care_offering_id) DO UPDATE SET
			term_kind = EXCLUDED.term_kind, term_months = EXCLUDED.term_months,
			notice_months = EXCLUDED.notice_months, notice_to = EXCLUDED.notice_to,
			special_termination = EXCLUDED.special_termination,
			special_termination_note = EXCLUDED.special_termination_note,
			statute_required = EXCLUDED.statute_required, statute_title = EXCLUDED.statute_title,
			statute_url = EXCLUDED.statute_url, contract_partner = EXCLUDED.contract_partner,
			updated_by_account_id = EXCLUDED.updated_by_account_id
		WHERE ?
		RETURNING `+templateColumns,
		organizationID, schoolID, offeringID, input.TermKind, input.TermMonths, input.NoticeMonths, input.NoticeTo,
		input.SpecialTermination, input.SpecialTerminationNote, input.StatuteRequired, input.StatuteTitle,
		input.StatuteURL, input.ContractPartner, accountID, replace).Scan(ctx, &row)
	if !replace && errors.Is(err, sql.ErrNoRows) {
		return carecontract.ContractTemplate{}, readstate.ErrChanged
	}
	if err != nil {
		return carecontract.ContractTemplate{}, fmt.Errorf("care contract postgres: save template: %w", err)
	}
	return row.template(), nil
}

// InsertContract stores a draft with its first version, the version's
// services and its party. A second contract for the same application child
// is ErrContractExists.
func (Store) InsertContract(ctx context.Context, organizationID, accountID int64, contract ports.NewContract) (int64, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	var id int64
	err = db.NewRaw(`INSERT INTO care_contract.contracts (organization_id, school_id, request_child_id,
			student_id, created_by_account_id, early_start_requested)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (school_id, request_child_id) DO NOTHING
		RETURNING id`, organizationID, contract.Key.SchoolID, contract.Key.RequestChildID,
		contract.StudentID, accountRef(accountID), contract.EarlyStart).Scan(ctx, &id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, carecontract.ErrContractExists
	}
	if err != nil {
		return 0, fmt.Errorf("care contract postgres: insert contract: %w", err)
	}
	if _, err := insertVersion(ctx, db, organizationID, id, contract.Version); err != nil {
		return 0, err
	}
	party := contract.Party
	if _, err := db.ExecContext(ctx, `INSERT INTO care_contract.contract_parties (organization_id, contract_id,
			first_name, last_name, email, account_id) VALUES (?, ?, ?, ?, ?, ?)`,
		organizationID, id, party.FirstName, party.LastName, party.Email, party.AccountID); err != nil {
		return 0, fmt.Errorf("care contract postgres: insert party: %w", err)
	}
	return id, nil
}

// insertServices stores the booked services of a version in one statement;
// an empty end time stays NULL.
func insertServices(ctx context.Context, db bun.IDB, organizationID, versionID int64, services []carecontract.Service) error {
	if len(services) == 0 {
		return nil
	}
	weekdays, offerings := make([]string, len(services)), make([]int64, len(services))
	names, ends, lastDays := make([]string, len(services)), make([]string, len(services)), make([]string, len(services))
	for i, service := range services {
		weekdays[i], offerings[i], names[i], ends[i] = service.Weekday, service.CareOfferingID.Int64(), service.ModuleName, service.EndsAt
		if service.LastDay != nil {
			lastDays[i] = service.LastDay.String()
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO care_contract.contract_version_services
			(organization_id, contract_version_id, weekday, care_offering_id, module_name, ends_at, last_day)
		SELECT ?, ?, s.weekday, s.care_offering_id, s.module_name, NULLIF(s.ends_at, '')::time, NULLIF(s.last_day, '')::date
		FROM unnest(?::text[], ?::bigint[], ?::text[], ?::text[], ?::text[])
			AS s(weekday, care_offering_id, module_name, ends_at, last_day)`,
		organizationID, versionID, pgdialect.Array(weekdays), pgdialect.Array(offerings), pgdialect.Array(names),
		pgdialect.Array(ends), pgdialect.Array(lastDays)); err != nil {
		return fmt.Errorf("care contract postgres: insert services: %w", err)
	}
	return nil
}

// moduleNamesSQL lists the modules of version v in the order of their first
// weekday.
const moduleNamesSQL = `ARRAY(SELECT s.module_name FROM care_contract.contract_version_services AS s
		WHERE s.organization_id = v.organization_id AND s.contract_version_id = v.id
		GROUP BY s.module_name
		ORDER BY MIN(array_position(ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[], s.weekday::text)), s.module_name)`

const summaryColumnsSQL = `SELECT c.id, c.status, c.school_id, c.student_id, c.created_at, c.sent_at, c.concluded_at, c.conclusion_method,
	c.conclusion_date_unknown, c.import_origin IS NOT NULL AS taken_over, c.ends_on, c.early_start_requested, c.import_origin IS NOT NULL AS imported,
	c.request_child_id IS NOT NULL AS follows_bookings, c.request_child_id, c.updated_at,
	(c.status = '` + carecontract.StatusActive + `' AND EXISTS (SELECT 1 FROM care_contract.contract_versions AS w
		WHERE w.organization_id = c.organization_id AND w.contract_id = c.id
			AND w.status = '` + carecontract.VersionRequested + `')) AS change_awaits_signature,
	v.school_name, v.child_first_name, v.child_last_name, ` + moduleNamesSQL + ` AS module_names, v.effective_from,
	COALESCE(p.first_name || ' ' || p.last_name, '') AS party_name, COALESCE(p.email, '') AS party_email`

const summaryPartySQL = `
	LEFT JOIN LATERAL (SELECT * FROM care_contract.contract_parties AS cp
		WHERE cp.organization_id = c.organization_id AND cp.contract_id = c.id
		ORDER BY cp.id LIMIT 1) AS p ON true`

const summaryJoinsSQL = `
	FROM care_contract.contracts AS c
	JOIN LATERAL (SELECT * FROM care_contract.contract_versions AS v
		WHERE v.organization_id = c.organization_id AND v.contract_id = c.id
		ORDER BY ` + currentVersionOrderSQL + ` LIMIT 1) AS v ON true` + summaryPartySQL

// summarySQL reads a contract with its current version and first party.
// Bind order: today twice, then organization_id.
const summarySQL = summaryColumnsSQL + summaryJoinsSQL + ` WHERE c.organization_id = ?`

// The revision covers membership and order, including the current version
// selected for this day, not writes such as recording a PDF download.
// The aggregate and page use one statement snapshot. Full summaries are read only for
// the page (including the extra row used to tell if more are available).
// The two unnumbered arguments bind the existing version order to today.
const contractMatchesSQL = `matching AS MATERIALIZED (
	SELECT c.id, c.status, c.created_at, v.id AS version_id,
		v.effective_from, v.child_last_name, v.child_first_name, v.school_name` + summaryJoinsSQL + `
	WHERE c.organization_id = ?2 AND (?3 = '' OR c.status = ?3) AND (?4 = 0 OR c.school_id = ?4)
	AND (?5 = '' OR (v.child_first_name || ' ' || v.child_last_name || ' ' || COALESCE(p.first_name || ' ' || p.last_name, '')
		|| ' ' || COALESCE(p.email, '') || ' ' || array_to_string(` + moduleNamesSQL + `, ' ')) ILIKE ?5)
), revision AS (
	SELECT CASE WHEN ?11 THEN '' ELSE COALESCE(SUM(hashtextextended(ROW(
		id, status, created_at, version_id, effective_from, child_last_name, child_first_name, school_name)::text, 0)), 0)::text END AS value
	FROM matching
)`

// Order the states in the order of their life. The start is counted in
// days since a fixed day, so one term orders it in both directions.
const contractOrderSQL = `CASE ?6 WHEN '` + carecontract.ContractSortStart + `' THEN effective_from - DATE '2000-01-01'
			WHEN '` + carecontract.ContractSortStatus + `' THEN array_position(ARRAY['` + carecontract.StatusDraft + `','` + carecontract.StatusSent + `','` +
	carecontract.StatusActive + `','` + carecontract.StatusTerminated + `','` + carecontract.StatusWithdrawn + `','` + carecontract.StatusEnded + `']::text[], status::text)
			END * (CASE WHEN ?7 THEN -1 ELSE 1 END),
		CASE WHEN ?6 = '` + carecontract.ContractSortChild + `' AND NOT ?7 THEN child_last_name END COLLATE public.german_name ASC,
		CASE WHEN ?6 = '` + carecontract.ContractSortChild + `' AND ?7 THEN child_last_name END COLLATE public.german_name DESC,
		CASE WHEN ?6 = '` + carecontract.ContractSortChild + `' AND NOT ?7 THEN child_first_name END COLLATE public.german_name ASC,
		CASE WHEN ?6 = '` + carecontract.ContractSortChild + `' AND ?7 THEN child_first_name END COLLATE public.german_name DESC,
		CASE WHEN ?6 = '` + carecontract.ContractSortSchool + `' AND NOT ?7 THEN school_name END COLLATE public.german_name ASC,
		CASE WHEN ?6 = '` + carecontract.ContractSortSchool + `' AND ?7 THEN school_name END COLLATE public.german_name DESC,
		created_at DESC, id DESC`

const listContractsSQL = `SELECT result.* FROM (WITH ` + contractMatchesSQL + `, page AS MATERIALIZED (
	SELECT id, version_id, row_number() OVER (ORDER BY ` + contractOrderSQL + `) AS place
	FROM (
		SELECT * FROM matching ORDER BY ` + contractOrderSQL + `
		LIMIT ?8 OFFSET (SELECT CASE WHEN ?10 <> '' AND ?10 <> value THEN 0 ELSE ?9::bigint END FROM revision)
	) AS selected
), summaries AS (
	` + summaryColumnsSQL + `, page.place
	FROM page
	JOIN care_contract.contracts AS c ON c.organization_id = ?2 AND c.id = page.id
	JOIN care_contract.contract_versions AS v ON v.organization_id = c.organization_id AND v.id = page.version_id` + summaryPartySQL + `
)
SELECT summaries.*, revision.value AS revision FROM revision LEFT JOIN summaries ON true
) AS result ORDER BY result.place`

const contractSQL = summarySQL + ` AND c.id = ?`

type summaryRow struct {
	ChangeAwaits   bool          `bun:"change_awaits_signature"`
	StudentID      *int64        `bun:"student_id"`
	ID             int64         `bun:"id"`
	Status         string        `bun:"status"`
	SchoolID       int64         `bun:"school_id"`
	CreatedAt      time.Time     `bun:"created_at"`
	SentAt         *time.Time    `bun:"sent_at"`
	ConcludedAt    *time.Time    `bun:"concluded_at"`
	Method         *string       `bun:"conclusion_method"`
	DateUnknown    bool          `bun:"conclusion_date_unknown"`
	TakenOver      bool          `bun:"taken_over"`
	SchoolName     string        `bun:"school_name"`
	ChildFirstName string        `bun:"child_first_name"`
	ChildLastName  string        `bun:"child_last_name"`
	ModuleNames    []string      `bun:"module_names,array"`
	EffectiveFrom  calendar.Date `bun:"effective_from,type:date"`
	PartyName      string        `bun:"party_name"`
	PartyEmail     string        `bun:"party_email"`
	// EndsOn is the last day of a terminated contract; EarlyStart the
	// parents' wish that care begins within the withdrawal period (#4682).
	EndsOn     *calendar.Date `bun:"ends_on,type:date"`
	EarlyStart bool           `bun:"early_start_requested"`
	Imported   bool           `bun:"imported"`
	// FollowsBookings tells that the contract has an application child,
	// RequestChildID which.
	FollowsBookings bool   `bun:"follows_bookings"`
	RequestChildID  *int64 `bun:"request_child_id"`
	// UpdatedAt is the stamp of the last write of the contract row.
	UpdatedAt time.Time `bun:"updated_at"`
}

func (r summaryRow) summary() carecontract.ContractSummary {
	return carecontract.ContractSummary{
		ID: ident.ID(r.ID), StudentID: (*ident.ID)(r.StudentID), Status: r.Status, SchoolID: ident.ID(r.SchoolID), SchoolName: r.SchoolName,
		ChildFirstName: r.ChildFirstName, ChildLastName: r.ChildLastName, ModuleNames: nonNil(r.ModuleNames),
		ModulesText: carecontract.JoinNames(r.ModuleNames),
		PartyName:   strings.TrimSpace(r.PartyName), PartyEmail: r.PartyEmail, EffectiveFrom: r.EffectiveFrom,
		CreatedAt: r.CreatedAt, SentAt: r.SentAt, Concluded: r.concluded(), EndsOn: r.EndsOn,
		Imported: r.Imported, FollowsBookings: r.FollowsBookings, RequestChildID: (*ident.ID)(r.RequestChildID),
		ChangeAwaitsSignature: r.ChangeAwaits,
	}
}

func (r summaryRow) concluded() *carecontract.Concluded {
	if r.ConcludedAt == nil || r.Method == nil {
		return nil
	}
	return &carecontract.Concluded{Method: *r.Method, At: *r.ConcludedAt, DateUnknown: r.DateUnknown, TakenOver: r.TakenOver}
}

// accountRef is the acting account, or NULL for the automatic conclusion,
// which acts for no account.
func accountRef(accountID int64) *int64 {
	if accountID <= 0 {
		return nil
	}
	return &accountID
}

// ListContracts lists the contracts of the filter in its order, newest
// first without one.
func (s Store) ListContracts(ctx context.Context, organizationID int64, filter carecontract.ContractFilter) ([]carecontract.ContractSummary, string, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, "", err
	}
	today, err := s.day()
	if err != nil {
		return nil, "", err
	}
	search := ""
	if filter.Search != "" {
		search = "%" + likeEscape(filter.Search) + "%"
	}
	var rows []struct {
		summaryRow
		Revision string `bun:"revision"`
		Place    int64  `bun:"place"`
	}
	if err := db.NewRaw(listContractsSQL, today, today, organizationID, filter.Status, filter.SchoolID, search,
		filter.Sort, filter.Descending, filter.Limit+1, filter.Offset, filter.Revision, filter.Export).Scan(ctx, &rows); err != nil {
		return nil, "", fmt.Errorf("care contract postgres: list contracts: %w", err)
	}
	result := make([]carecontract.ContractSummary, 0, len(rows))
	for _, row := range rows {
		// The left join returns the revision even for an empty page.
		if row.Place != 0 {
			result = append(result, row.summary())
		}
	}
	return result, rows[0].Revision, nil
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func likeEscape(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}

func (Store) CountContracts(ctx context.Context, organizationID int64) (map[string]int, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Status string `bun:"status"`
		Count  int    `bun:"count"`
	}
	if err := db.NewRaw(`SELECT status, COUNT(*) AS count FROM care_contract.contracts
		WHERE organization_id = ? GROUP BY status`, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: count contracts: %w", err)
	}
	counts := map[string]int{}
	for _, row := range rows {
		counts[row.Status] = row.Count
	}
	return counts, nil
}

// InsertEvents appends entries to the trail in one statement.
func (Store) InsertEvents(ctx context.Context, organizationID int64, events []ports.Event) error {
	if len(events) == 0 {
		return nil
	}
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	contractIDs, schoolIDs := make([]*int64, len(events)), make([]*int64, len(events))
	accountIDs, actions, details := make([]*int64, len(events)), make([]string, len(events)), make([]string, len(events))
	for i, event := range events {
		encoded, err := json.Marshal(event.Details)
		if err != nil {
			return fmt.Errorf("care contract postgres: event details: %w", err)
		}
		contractIDs[i], schoolIDs[i], accountIDs[i], actions[i], details[i] = event.ContractID, event.SchoolID, accountRef(event.AccountID), event.Action, string(encoded)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO care_contract.contract_events
			(organization_id, contract_id, school_id, account_id, action, details)
		SELECT ?, e.contract_id, e.school_id, NULLIF(e.account_id, 0), e.action, e.details::jsonb
		FROM unnest(?::bigint[], ?::bigint[], ?::bigint[], ?::text[], ?::text[])
			AS e(contract_id, school_id, account_id, action, details)`,
		organizationID, pgdialect.Array(contractIDs), pgdialect.Array(schoolIDs), pgdialect.Array(accountIDs),
		pgdialect.Array(actions), pgdialect.Array(details)); err != nil {
		return fmt.Errorf("care contract postgres: insert events: %w", err)
	}
	return nil
}
