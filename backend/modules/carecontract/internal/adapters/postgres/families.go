package postgres

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The families of the contracts without a mail address (#7161, ADR 0319).

// partyHasEmailSQL tells whether a party of contract c has a mail address.
const partyHasEmailSQL = `EXISTS (SELECT 1 FROM care_contract.contract_parties AS e
		WHERE e.organization_id = c.organization_id AND e.contract_id = c.id AND COALESCE(BTRIM(e.email), '') <> '')`

// familyContractsSQL reads the contracts that are no draft and whose
// parties have no mail address, with their current version
// (currentVersionOrderSQL) and their first party. Bind order: today twice,
// organization_id, the draft status.
const familyContractsSQL = `SELECT c.id, c.status, c.school_id, c.family_contract_id, c.ends_on,
	v.school_name, v.child_first_name, v.child_last_name, v.child_birth_date, v.effective_from,
	concat_ws(' ', NULLIF(p.first_name, ''), NULLIF(p.last_name, '')) AS party_name
	FROM care_contract.contracts AS c
	JOIN LATERAL (SELECT * FROM care_contract.contract_versions AS v
		WHERE v.organization_id = c.organization_id AND v.contract_id = c.id
		ORDER BY ` + currentVersionOrderSQL + ` LIMIT 1) AS v ON true
	LEFT JOIN LATERAL (SELECT * FROM care_contract.contract_parties AS cp
		WHERE cp.organization_id = c.organization_id AND cp.contract_id = c.id
		ORDER BY cp.id LIMIT 1) AS p ON true
	WHERE c.organization_id = ? AND c.status <> ? AND NOT ` + partyHasEmailSQL + `
	ORDER BY lower(v.child_last_name), lower(v.child_first_name), c.id`

type familyContractRow struct {
	ID               int64          `bun:"id"`
	Status           string         `bun:"status"`
	SchoolID         int64          `bun:"school_id"`
	FamilyContractID *int64         `bun:"family_contract_id"`
	EndsOn           *calendar.Date `bun:"ends_on,type:date"`
	SchoolName       string         `bun:"school_name"`
	ChildFirstName   string         `bun:"child_first_name"`
	ChildLastName    string         `bun:"child_last_name"`
	ChildBirthDate   *calendar.Date `bun:"child_birth_date,type:date"`
	EffectiveFrom    calendar.Date  `bun:"effective_from,type:date"`
	PartyName        string         `bun:"party_name"`
}

// LockFamilies takes the lock of the Träger's families for the rest of the
// transaction: a second change waits and then reads what the first stored.
func (Store) LockFamilies(ctx context.Context, organizationID int64) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if _, err := db.NewRaw(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`,
		fmt.Sprintf("care_contract.families:%d", organizationID)).Exec(ctx); err != nil {
		return fmt.Errorf("care contract postgres: lock the families: %w", err)
	}
	return nil
}

// FamilyContracts reads the contracts without a mail address in one
// statement.
func (s Store) FamilyContracts(ctx context.Context, organizationID int64) ([]carecontract.FamilyMember, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	today, err := s.day()
	if err != nil {
		return nil, err
	}
	var rows []familyContractRow
	if err := db.NewRaw(familyContractsSQL, today, today, organizationID, carecontract.StatusDraft).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the contracts without a mail address: %w", err)
	}
	members := make([]carecontract.FamilyMember, len(rows))
	for i, row := range rows {
		lead := row.ID
		if row.FamilyContractID != nil {
			lead = *row.FamilyContractID
		}
		members[i] = carecontract.FamilyMember{ContractID: ident.ID(row.ID), FamilyContractID: ident.ID(lead), Status: row.Status,
			SchoolID: ident.ID(row.SchoolID), SchoolName: row.SchoolName, ChildFirstName: row.ChildFirstName,
			ChildLastName: row.ChildLastName, ChildBirthDate: row.ChildBirthDate, PartyName: strings.TrimSpace(row.PartyName),
			EffectiveFrom: row.EffectiveFrom, EndsOn: row.EndsOn}
	}
	return members, nil
}

// FamilyStates reads the named contracts and their families in one
// statement.
func (Store) FamilyStates(ctx context.Context, organizationID int64, contractIDs []int64) ([]ports.FamilyState, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if len(contractIDs) == 0 {
		return nil, nil
	}
	var rows []struct {
		ID               int64  `bun:"id"`
		SchoolID         int64  `bun:"school_id"`
		FamilyContractID *int64 `bun:"family_contract_id"`
		Draft            bool   `bun:"draft"`
		HasEmail         bool   `bun:"has_email"`
	}
	if err := db.NewRaw(`SELECT c.id, c.school_id, c.family_contract_id, c.status = ? AS draft, `+partyHasEmailSQL+` AS has_email
		FROM care_contract.contracts AS c
		WHERE c.organization_id = ? AND (c.id = ANY(?) OR COALESCE(c.family_contract_id, c.id) IN (
			SELECT COALESCE(x.family_contract_id, x.id) FROM care_contract.contracts AS x
			WHERE x.organization_id = ? AND x.id = ANY(?)))
		ORDER BY c.id`, carecontract.StatusDraft, organizationID, pgdialect.Array(contractIDs), organizationID,
		pgdialect.Array(contractIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the families of the contracts: %w", err)
	}
	states := make([]ports.FamilyState, len(rows))
	for i, row := range rows {
		states[i] = ports.FamilyState{ContractID: row.ID, SchoolID: row.SchoolID, Draft: row.Draft, HasEmail: row.HasEmail}
		if row.FamilyContractID != nil {
			states[i].FamilyContractID = *row.FamilyContractID
		}
	}
	return states, nil
}

// SetFamilies stores the leading contracts and writes one entry per change
// into the trail.
func (Store) SetFamilies(ctx context.Context, organizationID, accountID int64, action string, changes []ports.FamilyChange) error {
	if len(changes) == 0 {
		return nil
	}
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	ids, leads, schools, from := make([]int64, len(changes)), make([]int64, len(changes)), make([]int64, len(changes)), make([]int64, len(changes))
	for i, change := range changes {
		ids[i], leads[i], schools[i], from[i] = change.ContractID, change.FamilyContractID, change.SchoolID, change.From
	}
	if _, err := db.ExecContext(ctx, `UPDATE care_contract.contracts AS c SET family_contract_id = NULLIF(u.lead, 0)
		FROM unnest(?::bigint[], ?::bigint[]) AS u(id, lead)
		WHERE c.organization_id = ? AND c.id = u.id`, pgdialect.Array(ids), pgdialect.Array(leads), organizationID); err != nil {
		return fmt.Errorf("care contract postgres: set the families: %w", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO care_contract.contract_events
			(organization_id, contract_id, school_id, account_id, action, details)
		SELECT ?, u.id, u.school_id, ?, ?, jsonb_build_object('family_contract_id', CASE WHEN u.lead = 0 THEN u.id ELSE u.lead END,
			'previous_family_contract_id', u.from_lead)
		FROM unnest(?::bigint[], ?::bigint[], ?::bigint[], ?::bigint[]) AS u(id, lead, school_id, from_lead)`,
		organizationID, accountRef(accountID), action, pgdialect.Array(ids), pgdialect.Array(leads), pgdialect.Array(schools),
		pgdialect.Array(from)); err != nil {
		return fmt.Errorf("care contract postgres: record the families: %w", err)
	}
	return nil
}

// FamilyEvents reads the newest joins and leaves with the child of the
// current version of each contract. Bind order: today twice first.
func (s Store) FamilyEvents(ctx context.Context, organizationID int64, limit int) ([]carecontract.FamilyEvent, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	today, err := s.day()
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID        int64     `bun:"id"`
		Action    string    `bun:"action"`
		Contract  int64     `bun:"contract_id"`
		Family    int64     `bun:"family_contract_id"`
		Previous  int64     `bun:"previous_family_contract_id"`
		AccountID *int64    `bun:"account_id"`
		At        time.Time `bun:"created_at"`
		First     string    `bun:"child_first_name"`
		Last      string    `bun:"child_last_name"`
	}
	if err := db.NewRaw(`SELECT e.id, e.action, e.contract_id, (e.details->>'family_contract_id')::bigint AS family_contract_id,
			(e.details->>'previous_family_contract_id')::bigint AS previous_family_contract_id, e.account_id, e.created_at,
			COALESCE(v.child_first_name, '') AS child_first_name, COALESCE(v.child_last_name, '') AS child_last_name
		FROM care_contract.contract_events AS e
		LEFT JOIN LATERAL (SELECT * FROM care_contract.contract_versions AS v
			WHERE v.organization_id = e.organization_id AND v.contract_id = e.contract_id
			ORDER BY `+currentVersionOrderSQL+` LIMIT 1) AS v ON true
		WHERE e.organization_id = ? AND e.action IN (?, ?)
		ORDER BY e.created_at DESC, e.id DESC LIMIT ?`, today, today, organizationID, ports.ActionJoinFamily, ports.ActionLeaveFamily,
		limit).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the trail of the families: %w", err)
	}
	events := make([]carecontract.FamilyEvent, len(rows))
	for i, row := range rows {
		events[i] = carecontract.FamilyEvent{ID: ident.ID(row.ID), Action: row.Action, ContractID: ident.ID(row.Contract),
			FamilyContractID: ident.ID(row.Family), PreviousFamilyContractID: ident.ID(row.Previous), ChildFirstName: row.First,
			ChildLastName: row.Last, AccountID: (*ident.ID)(row.AccountID), At: row.At}
	}
	return events, nil
}
