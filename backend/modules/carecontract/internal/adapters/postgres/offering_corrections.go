package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The persistence of the correction of the booked modules (#7764). Every
// statement runs in the Träger transaction and names the Träger in its own
// filter; none depends on the number of contracts of the file.

// CorrectableContracts reads the contracts of the ids with their effective
// versions by effective date. With lock it takes the row lock of each
// contract, the lock an amendment and a termination take, so the timeline it
// answers holds until the transaction ends.
func (Store) CorrectableContracts(ctx context.Context, organizationID int64, ids []int64, lock bool) ([]ports.CorrectableContract, error) {
	if len(ids) == 0 {
		return []ports.CorrectableContract{}, nil
	}
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if lock {
		// The locks are taken in the order of the ids, like every other
		// statement that locks several contracts, before the read below.
		var locked []int64
		if err := db.NewRaw(`SELECT id FROM care_contract.contracts WHERE organization_id = ? AND id = ANY(?) ORDER BY id FOR UPDATE`,
			organizationID, pgdialect.Array(ids)).Scan(ctx, &locked); err != nil {
			return nil, fmt.Errorf("care contract postgres: lock contracts to correct: %w", err)
		}
	}
	var heads []struct {
		ContractID      int64          `bun:"contract_id"`
		SchoolID        int64          `bun:"school_id"`
		Status          string         `bun:"status"`
		FollowsBookings bool           `bun:"follows_bookings"`
		EndsOn          *calendar.Date `bun:"ends_on,type:date"`
		NextNumber      int            `bun:"next_number"`
	}
	if err := db.NewRaw(`SELECT c.id AS contract_id, c.school_id, c.status, c.request_child_id IS NOT NULL AS follows_bookings, c.ends_on,
			(SELECT COALESCE(MAX(m.version_number), 0) + 1 FROM care_contract.contract_versions AS m
				WHERE m.organization_id = c.organization_id AND m.contract_id = c.id) AS next_number
		FROM care_contract.contracts AS c
		WHERE c.organization_id = ? AND c.id = ANY(?) ORDER BY c.id`, organizationID, pgdialect.Array(ids)).Scan(ctx, &heads); err != nil {
		return nil, fmt.Errorf("care contract postgres: read contracts to correct: %w", err)
	}
	timelines, err := effectiveTimelines(ctx, db, organizationID, ids)
	if err != nil {
		return nil, err
	}
	contracts := make([]ports.CorrectableContract, len(heads))
	for i, head := range heads {
		contracts[i] = ports.CorrectableContract{ID: head.ContractID, SchoolID: head.SchoolID, Status: head.Status,
			FollowsBookings: head.FollowsBookings, EndsOn: head.EndsOn, NextNumber: head.NextNumber, Versions: timelines[head.ContractID]}
	}
	return contracts, nil
}

// correctedStep is the step of one new version on the timeline of its
// contract: the version it follows or replaces, and that version's status
// before and after.
type correctedStep struct {
	VersionID  int64  `json:"version_id"`
	ContractID int64  `json:"contract_id"`
	FromStatus string `json:"from_status"`
	ToStatus   string `json:"to_status"`
}

// correctedRecord is one new version as the insert statement reads it.
type correctedRecord struct {
	ContractID             int64                  `json:"contract_id"`
	VersionNumber          int                    `json:"version_number"`
	Status                 string                 `json:"status"`
	EffectiveFrom          calendar.Date          `json:"effective_from"`
	EndsOn                 *calendar.Date         `json:"ends_on"`
	ChildFirstName         string                 `json:"child_first_name"`
	ChildLastName          string                 `json:"child_last_name"`
	ChildBirthDate         *calendar.Date         `json:"child_birth_date"`
	SchoolName             string                 `json:"school_name"`
	PhaseName              string                 `json:"phase_name"`
	PriceCents             *int64                 `json:"price_cents"`
	TermKind               string                 `json:"term_kind"`
	TermMonths             *int                   `json:"term_months"`
	NoticeMonths           int                    `json:"notice_months"`
	NoticeTo               string                 `json:"notice_to"`
	SpecialTermination     bool                   `json:"special_termination"`
	SpecialTerminationNote string                 `json:"special_termination_note"`
	StatuteRequired        bool                   `json:"statute_required"`
	StatuteTitle           string                 `json:"statute_title"`
	StatuteURL             string                 `json:"statute_url"`
	ContractPartner        string                 `json:"contract_partner"`
	Source                 string                 `json:"source"`
	Services               []carecontract.Service `json:"services"`
}

func correctedRecordOf(corrected ports.CorrectedVersion) correctedRecord {
	version, terms := corrected.Version, corrected.Version.Terms
	return correctedRecord{
		ContractID: corrected.ContractID, VersionNumber: version.Number, Status: version.Status,
		EffectiveFrom: version.EffectiveFrom, EndsOn: version.EndsOn, ChildFirstName: version.ChildFirstName,
		ChildLastName: version.ChildLastName, ChildBirthDate: version.ChildBirthDate, SchoolName: version.SchoolName,
		PhaseName: version.PhaseName, PriceCents: version.PriceCents, TermKind: terms.TermKind, TermMonths: terms.TermMonths,
		NoticeMonths: terms.NoticeMonths, NoticeTo: terms.NoticeTo, SpecialTermination: terms.SpecialTermination,
		SpecialTerminationNote: terms.SpecialTerminationNote, StatuteRequired: terms.StatuteRequired,
		StatuteTitle: terms.StatuteTitle, StatuteURL: terms.StatuteURL, ContractPartner: terms.ContractPartner,
		Source: version.Source, Services: version.Services,
	}
}

// stepCorrectedVersionsSQL moves the version each new one follows or
// replaces; a version that is no longer in its status moves nothing.
const stepCorrectedVersionsSQL = `UPDATE care_contract.contract_versions AS v SET status = u.to_status
	FROM jsonb_to_recordset(?::jsonb) AS u(version_id bigint, contract_id bigint, from_status text, to_status text)
	WHERE v.organization_id = ? AND v.id = u.version_id AND v.contract_id = u.contract_id AND v.status = u.from_status`

// insertCorrectedVersionsSQL stores every new version with its services in
// one statement.
const insertCorrectedVersionsSQL = `WITH input AS (
	SELECT * FROM jsonb_to_recordset(?::jsonb) AS i(contract_id bigint, version_number int, status text,
		effective_from date, ends_on date, child_first_name text, child_last_name text, child_birth_date date,
		school_name text, phase_name text, price_cents bigint, term_kind text, term_months smallint,
		notice_months smallint, notice_to text, special_termination boolean, special_termination_note text,
		statute_required boolean, statute_title text, statute_url text, contract_partner text, source text, services jsonb)
), version AS (
	INSERT INTO care_contract.contract_versions (organization_id, contract_id, version_number, status, effective_from,
		ends_on, child_first_name, child_last_name, child_birth_date, school_name, phase_name, price_cents, term_kind,
		term_months, notice_months, notice_to, special_termination, special_termination_note, statute_required,
		statute_title, statute_url, contract_partner, source)
	SELECT ?, i.contract_id, i.version_number, i.status, i.effective_from, i.ends_on, i.child_first_name,
		i.child_last_name, i.child_birth_date, i.school_name, i.phase_name, i.price_cents, i.term_kind, i.term_months,
		i.notice_months, i.notice_to, i.special_termination, i.special_termination_note, i.statute_required,
		i.statute_title, i.statute_url, i.contract_partner, i.source
	FROM input AS i ORDER BY i.contract_id
	RETURNING id, contract_id
), service AS (
	INSERT INTO care_contract.contract_version_services (organization_id, contract_version_id, weekday, care_offering_id,
		module_name, ends_at, last_day)
	SELECT ?, v.id, s.weekday, s.care_offering_id, s.module_name, NULLIF(s.ends_at, '')::time, s.last_day
	FROM input AS i
	JOIN version AS v ON v.contract_id = i.contract_id
	CROSS JOIN LATERAL jsonb_to_recordset(i.services) AS s(weekday text, care_offering_id bigint, module_name text,
		ends_at text, last_day date)
)
SELECT v.contract_id, v.id AS version_id FROM version AS v`

// InsertCorrectedVersions stores the new versions of a correction, each
// after its step on the timeline, and answers the version of each contract.
// A stepped version that is no longer in its status is ErrVersionMoved:
// another run changed the contract since the read. The triggers of 1.15.787
// refuse an overlap and a version in the past.
func (Store) InsertCorrectedVersions(ctx context.Context, organizationID int64, corrected []ports.CorrectedVersion) (map[int64]int64, error) {
	stored := map[int64]int64{}
	if len(corrected) == 0 {
		return stored, nil
	}
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	steps, records := make([]correctedStep, len(corrected)), make([]correctedRecord, len(corrected))
	for i, version := range corrected {
		steps[i] = correctedStepOf(version)
		records[i] = correctedRecordOf(version)
	}
	encoded, err := json.Marshal(steps)
	if err != nil {
		return nil, fmt.Errorf("care contract postgres: encode corrected steps: %w", err)
	}
	result, err := db.ExecContext(ctx, stepCorrectedVersionsSQL, string(encoded), organizationID)
	if err != nil {
		return nil, fmt.Errorf("care contract postgres: step corrected versions: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != int64(len(steps)) {
		return nil, ports.ErrVersionMoved
	}
	if encoded, err = json.Marshal(records); err != nil {
		return nil, fmt.Errorf("care contract postgres: encode corrected versions: %w", err)
	}
	var rows []struct {
		ContractID int64 `bun:"contract_id"`
		VersionID  int64 `bun:"version_id"`
	}
	if err := db.NewRaw(insertCorrectedVersionsSQL, string(encoded), organizationID, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: insert corrected versions: %w", err)
	}
	for _, row := range rows {
		stored[row.ContractID] = row.VersionID
	}
	return stored, nil
}

// correctedStepOf names the version the new one replaces (it becomes
// ersetzt) or follows (it becomes abgeloest).
func correctedStepOf(corrected ports.CorrectedVersion) correctedStep {
	step := correctedStep{VersionID: corrected.Step.Supersede, ContractID: corrected.ContractID,
		FromStatus: corrected.Step.Status, ToStatus: carecontract.VersionSuperseded}
	if corrected.Step.Replace != 0 {
		step.VersionID, step.ToStatus = corrected.Step.Replace, carecontract.VersionReplaced
	}
	return step
}
