package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The versions of a contract over time (#4681). The effective versions
// (wirksam, abgeloest) form one timeline; the migration 1.15.787 keeps them
// apart. A version holds from its effective date to the day before the next
// effective version starts, or to its own end.

const effectiveStatusSQL = `('` + carecontract.VersionEffective + `', '` + carecontract.VersionSuperseded + `')`

// validUntilSQL is the last day version v holds; NULL when it holds open
// ended or is no effective version.
const validUntilSQL = `CASE WHEN v.status IN ` + effectiveStatusSQL + ` THEN LEAST(
		(SELECT MIN(n.effective_from) FROM care_contract.contract_versions AS n
			WHERE n.organization_id = v.organization_id AND n.contract_id = v.contract_id
				AND n.status IN ` + effectiveStatusSQL + ` AND n.effective_from > v.effective_from) - 1,
		v.ends_on) END`

// versionsSQL reads every version of a contract with its services, oldest
// first.
// The last day a version holds is cut at the last day of a terminated
// contract (#4682), so the list shows where the contract ends.
const versionsSQL = `SELECT ` + versionColumns + `, v.source, ` + servicesSQL + ` AS services,
	CASE WHEN v.status IN ` + effectiveStatusSQL + ` THEN LEAST(` + validUntilSQL + `,
		(SELECT c.ends_on FROM care_contract.contracts AS c WHERE c.organization_id = v.organization_id AND c.id = v.contract_id))
	END AS valid_until
	FROM care_contract.contract_versions AS v
	WHERE v.organization_id = ? AND v.contract_id = ? ORDER BY v.version_number`

func (Store) Versions(ctx context.Context, organizationID, contractID int64) ([]carecontract.Version, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []versionRow
	if err := db.NewRaw(versionsSQL, organizationID, contractID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read versions: %w", err)
	}
	return versionsOf(rows)
}

func versionsOf(rows []versionRow) ([]carecontract.Version, error) {
	versions := make([]carecontract.Version, len(rows))
	for i, row := range rows {
		version, err := row.version()
		if err != nil {
			return nil, err
		}
		versions[i] = version
	}
	return versions, nil
}

// AmendableContracts reads every active contract with an application child:
// one from an application, and an imported one bound to the enrollment of
// its child (ADR 0309). An imported contract that is not bound follows no
// bookings (#4723). Each comes with its effective
// versions by effective date, the start of version 1, which a fixed term
// counts from even when a later change goes before it, its next version
// number, and the stamp of the last write of its row (UpdatedAt).
func (Store) AmendableContracts(ctx context.Context, organizationID int64) ([]ports.AmendableContract, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	heads, err := amendableHeads(ctx, db, organizationID)
	if err != nil {
		return nil, err
	}
	if len(heads) == 0 {
		return []ports.AmendableContract{}, nil
	}
	contractIDs := make([]int64, len(heads))
	for i, head := range heads {
		contractIDs[i] = head.ContractID
	}
	timelines, err := versionTimelines(ctx, db, organizationID, contractIDs, effectiveStatuses)
	if err != nil {
		return nil, err
	}
	waiting, err := versionTimelines(ctx, db, organizationID, contractIDs, requestedStatuses)
	if err != nil {
		return nil, err
	}
	accounts, err := partyAccounts(ctx, db, organizationID, contractIDs)
	if err != nil {
		return nil, err
	}
	signed, err := signedRequests(ctx, db, organizationID, contractIDs)
	if err != nil {
		return nil, err
	}
	result := make([]ports.AmendableContract, 0, len(heads))
	for _, head := range heads {
		timeline := timelines[head.ContractID]
		if len(timeline) == 0 {
			continue
		}
		contract := ports.AmendableContract{
			ID: head.ContractID, Key: ports.ContractKey{SchoolID: head.SchoolID, RequestChildID: head.RequestChildID},
			UpdatedAt: head.UpdatedAt, FirstFrom: head.FirstFrom, NextNumber: head.NextNumber, Latest: timeline[len(timeline)-1], Versions: timeline,
			Parties: accounts[head.ContractID], SignedRequests: signed[head.ContractID],
		}
		if requested := waiting[head.ContractID]; len(requested) > 0 {
			contract.Waiting = &requested[0]
		}
		result = append(result, contract)
	}
	return result, nil
}

// requestedStatuses selects the version that waits for a signature (the
// index uq_contract_versions_requested keeps it to one per contract),
// effectiveStatuses the versions of the timeline.
var (
	requestedStatuses = []string{carecontract.VersionRequested}
	effectiveStatuses = []string{carecontract.VersionEffective, carecontract.VersionSuperseded}
)

// partyAccounts reads the contracts' parties with their parents account and
// address in one statement (#4816).
func partyAccounts(ctx context.Context, db bun.IDB, organizationID int64, ids []int64) (map[int64][]ports.PartyAccount, error) {
	var rows []struct {
		ContractID int64  `bun:"contract_id"`
		AccountID  *int64 `bun:"account_id"`
		Email      string `bun:"email"`
		Name       string `bun:"name"`
	}
	if err := db.NewRaw(`SELECT contract_id, account_id, email, btrim(first_name || ' ' || last_name) AS name FROM care_contract.contract_parties
		WHERE organization_id = ? AND contract_id = ANY(?) ORDER BY contract_id, id`,
		organizationID, pgdialect.Array(ids)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read party accounts: %w", err)
	}
	accounts := make(map[int64][]ports.PartyAccount, len(ids))
	for _, row := range rows {
		accounts[row.ContractID] = append(accounts[row.ContractID], ports.PartyAccount{AccountID: row.AccountID, Email: row.Email, Name: row.Name})
	}
	return accounts, nil
}

// signedRequests reads, per contract, the parents' requests that already
// count as the signature of one of its versions (#4816).
func signedRequests(ctx context.Context, db bun.IDB, organizationID int64, ids []int64) (map[int64][]int64, error) {
	var rows []struct {
		ContractID int64 `bun:"contract_id"`
		RequestID  int64 `bun:"change_request_id"`
	}
	if err := db.NewRaw(`SELECT contract_id, change_request_id FROM care_contract.contract_signatures
		WHERE organization_id = ? AND contract_id = ANY(?) AND change_request_id IS NOT NULL ORDER BY contract_id, id`,
		organizationID, pgdialect.Array(ids)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read signed requests: %w", err)
	}
	signed := make(map[int64][]int64, len(ids))
	for _, row := range rows {
		signed[row.ContractID] = append(signed[row.ContractID], row.RequestID)
	}
	return signed, nil
}

// SentContracts reads every sent contract with an application child and
// its version that waits for the first signature (#4816), by school.
func (Store) SentContracts(ctx context.Context, organizationID int64) ([]ports.SentContract, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var heads []struct {
		ContractID     int64     `bun:"contract_id"`
		SchoolID       int64     `bun:"school_id"`
		RequestChildID int64     `bun:"request_child_id"`
		UpdatedAt      time.Time `bun:"updated_at"`
		NextNumber     int       `bun:"next_number"`
	}
	if err := db.NewRaw(`SELECT c.id AS contract_id, c.school_id, c.request_child_id, c.updated_at,
			(SELECT MAX(m.version_number) + 1 FROM care_contract.contract_versions AS m
				WHERE m.organization_id = c.organization_id AND m.contract_id = c.id) AS next_number
		FROM care_contract.contracts AS c
		WHERE c.organization_id = ? AND c.status = ? AND c.request_child_id IS NOT NULL
		ORDER BY c.school_id, c.id`, organizationID, carecontract.StatusSent).Scan(ctx, &heads); err != nil {
		return nil, fmt.Errorf("care contract postgres: read sent contracts: %w", err)
	}
	if len(heads) == 0 {
		return []ports.SentContract{}, nil
	}
	contractIDs := make([]int64, len(heads))
	for i, head := range heads {
		contractIDs[i] = head.ContractID
	}
	waiting, err := versionTimelines(ctx, db, organizationID, contractIDs, requestedStatuses)
	if err != nil {
		return nil, err
	}
	result := make([]ports.SentContract, 0, len(heads))
	for _, head := range heads {
		if requested := waiting[head.ContractID]; len(requested) > 0 {
			result = append(result, ports.SentContract{
				ID: head.ContractID, Key: ports.ContractKey{SchoolID: head.SchoolID, RequestChildID: head.RequestChildID},
				UpdatedAt: head.UpdatedAt, NextNumber: head.NextNumber, Version: requested[0],
			})
		}
	}
	return result, nil
}

// versionTimelines reads the versions of the contracts in one of the
// given statuses by effective date, in one statement.
func versionTimelines(ctx context.Context, db bun.IDB, organizationID int64, ids []int64, statuses []string) (map[int64][]carecontract.Version, error) {
	var rows []periodRow
	if err := db.NewRaw(`SELECT v.contract_id, `+versionColumns+`, v.source, `+servicesSQL+` AS services, `+validUntilSQL+` AS valid_until
		FROM care_contract.contract_versions AS v
		WHERE v.organization_id = ? AND v.contract_id = ANY(?) AND v.status = ANY(?)
		ORDER BY v.contract_id, v.effective_from`, organizationID, pgdialect.Array(ids), pgdialect.Array(statuses)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read versions: %w", err)
	}
	timelines := make(map[int64][]carecontract.Version, len(ids))
	for _, row := range rows {
		version, err := row.version()
		if err != nil {
			return nil, err
		}
		timelines[row.ContractID] = append(timelines[row.ContractID], version)
	}
	return timelines, nil
}

// InsertVersion stores a new version after its step on the timeline: the
// wirksam version it follows becomes abgeloest, or the version starting on
// its day becomes ersetzt, or, before a planned version, nothing changes. A
// stepped version that is no longer in its status is ErrVersionMoved, so a
// concurrent run adds nothing twice. The triggers of 1.15.787 refuse an
// overlap and a version in the past.
func (Store) InsertVersion(ctx context.Context, organizationID, contractID int64, step ports.VersionStep, version carecontract.Version) (int64, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	if err := stepVersion(ctx, db, organizationID, contractID, step); err != nil {
		return 0, err
	}
	return insertVersion(ctx, db, organizationID, contractID, version)
}

// stepVersion moves the version a step names to the status the step gives
// it; a version that left the status the step expects is ErrVersionMoved.
func stepVersion(ctx context.Context, db bun.IDB, organizationID, contractID int64, step ports.VersionStep) error {
	stepped, status := step.Supersede, carecontract.VersionSuperseded
	switch {
	case step.Replace != 0:
		stepped, status = step.Replace, carecontract.VersionReplaced
	case step.Overtake != 0:
		stepped, status = step.Overtake, carecontract.VersionOvertaken
	}
	if stepped == 0 {
		return nil
	}
	result, err := db.ExecContext(ctx, `UPDATE care_contract.contract_versions SET status = ?
		WHERE organization_id = ? AND contract_id = ? AND id = ? AND status = ?`,
		status, organizationID, contractID, stepped, step.Status)
	if err != nil {
		return fmt.Errorf("care contract postgres: step version: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return ports.ErrVersionMoved
	}
	return nil
}

// OvertakeVersion ends the wait of a version nobody signed (#4816).
func (Store) OvertakeVersion(ctx context.Context, organizationID, contractID, versionID int64) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	return stepVersion(ctx, db, organizationID, contractID, ports.VersionStep{Overtake: versionID, Status: carecontract.VersionRequested})
}

// ActivateVersion moves a signed version into the timeline (#4816): first
// its step, then the version itself with the day it holds from. The
// triggers of 1.15.787 check the timeline as for a new version.
func (Store) ActivateVersion(ctx context.Context, organizationID, contractID int64, activation ports.VersionActivation) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if err := stepVersion(ctx, db, organizationID, contractID, activation.Step); err != nil {
		return err
	}
	result, err := db.ExecContext(ctx, `UPDATE care_contract.contract_versions SET status = ?, effective_from = ?, agreed_from = ?
		WHERE organization_id = ? AND contract_id = ? AND id = ? AND status = ?`,
		activation.Status, activation.EffectiveFrom, activation.AgreedFrom, organizationID, contractID, activation.VersionID,
		carecontract.VersionRequested)
	if err != nil {
		return fmt.Errorf("care contract postgres: activate version: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return ports.ErrVersionMoved
	}
	return nil
}

// WaitingVersion points record at the version of its contract that waits
// for a signature and at that version's stored PDF (#4816).
func (Store) WaitingVersion(ctx context.Context, organizationID int64, record *ports.ContractRecord) (bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return false, err
	}
	waiting, err := versionTimelines(ctx, db, organizationID, []int64{record.Summary.ID.Int64()}, requestedStatuses)
	if err != nil {
		return false, err
	}
	requested := waiting[record.Summary.ID.Int64()]
	if len(requested) == 0 {
		return false, nil
	}
	record.Version, record.DocumentID, record.Issuer = requested[0], nil, nil
	return true, readDocuments(ctx, db, organizationID, record)
}

func insertVersion(ctx context.Context, db bun.IDB, organizationID, contractID int64, version carecontract.Version) (int64, error) {
	terms := version.Terms
	source := version.Source
	if source == "" {
		source = carecontract.SourceConclusion
	}
	var versionID int64
	if err := db.NewRaw(`INSERT INTO care_contract.contract_versions (organization_id, contract_id,
			version_number, status, effective_from, ends_on, child_first_name, child_last_name, child_birth_date,
			school_name, phase_name, price_cents, term_kind, term_months, notice_months, notice_to, special_termination,
			special_termination_note, statute_required, statute_title, statute_url, contract_partner, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		organizationID, contractID, version.Number, version.Status, version.EffectiveFrom, version.EndsOn,
		version.ChildFirstName, version.ChildLastName, version.ChildBirthDate, version.SchoolName, version.PhaseName,
		version.PriceCents,
		terms.TermKind, terms.TermMonths, terms.NoticeMonths, terms.NoticeTo, terms.SpecialTermination,
		terms.SpecialTerminationNote, terms.StatuteRequired, terms.StatuteTitle, terms.StatuteURL,
		terms.ContractPartner, source).Scan(ctx, &versionID); err != nil {
		return 0, fmt.Errorf("care contract postgres: insert version: %w", err)
	}
	if err := insertServices(ctx, db, organizationID, versionID, version.Services); err != nil {
		return 0, err
	}
	return versionID, nil
}

// periodRow is one version in force with its contract.
type periodRow struct {
	versionRow
	ContractID int64  `bun:"contract_id"`
	SchoolID   int64  `bun:"school_id"`
	StudentID  *int64 `bun:"student_id"`
}

// VersionsInForce reads the effective versions of the active, terminated
// and ended contracts that hold on a day between from and to, by contract
// and start. A terminated contract cuts its versions at its last day
// (#4682); a withdrawn one holds on no day.
func (Store) VersionsInForce(ctx context.Context, organizationID int64, from, to calendar.Date, contractIDs []int64) ([]carecontract.VersionPeriod, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []periodRow
	if err := db.NewRaw(`SELECT * FROM (
			SELECT c.id AS contract_id, c.school_id, c.student_id, `+versionColumns+`, v.source, `+servicesSQL+` AS services,
				LEAST(`+validUntilSQL+`, c.ends_on) AS valid_until
			FROM care_contract.contracts AS c
			JOIN care_contract.contract_versions AS v ON v.organization_id = c.organization_id AND v.contract_id = c.id
			WHERE c.organization_id = ? AND c.status IN (?, ?, ?) AND v.status IN `+effectiveStatusSQL+`
				AND (c.ends_on IS NULL OR v.effective_from <= c.ends_on)
				AND v.effective_from <= ? AND (cardinality(?::bigint[]) = 0 OR c.id = ANY(?::bigint[]))) AS t
		WHERE t.valid_until IS NULL OR t.valid_until >= ?
		ORDER BY t.contract_id, t.effective_from`,
		organizationID, carecontract.StatusActive, carecontract.StatusTerminated, carecontract.StatusEnded, to,
		pgdialect.Array(nonNilIDs(contractIDs)),
		pgdialect.Array(nonNilIDs(contractIDs)), from).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read versions in force: %w", err)
	}
	periods := make([]carecontract.VersionPeriod, len(rows))
	for i, row := range rows {
		version, err := row.version()
		if err != nil {
			return nil, err
		}
		periods[i] = carecontract.VersionPeriod{ContractID: row.ContractID, SchoolID: row.SchoolID, StudentID: row.StudentID, Version: version}
	}
	return periods, nil
}

func nonNilIDs(ids []int64) []int64 {
	if ids == nil {
		return []int64{}
	}
	return ids
}

func (Store) VersionDocument(ctx context.Context, organizationID, versionID int64) (carecontract.File, bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return carecontract.File{}, false, err
	}
	var row documentRow
	err = db.NewRaw(`SELECT d.filename, d.pdf, d.withdrawal_notice FROM care_contract.contract_documents AS d
		WHERE d.organization_id = ? AND d.contract_version_id = ?`, organizationID, versionID).Scan(ctx, &row)
	if errors.Is(err, sql.ErrNoRows) {
		return carecontract.File{}, false, nil
	}
	file, err := row.file(err, carecontract.ErrVersionNotFound)
	return file, err == nil, err
}

// effectiveTimelines reads the effective versions of the contracts by
// effective date, in one statement.
func effectiveTimelines(ctx context.Context, db bun.IDB, organizationID int64, ids []int64) (map[int64][]carecontract.Version, error) {
	return versionTimelines(ctx, db, organizationID, ids, effectiveStatuses)
}

// amendableHead is an active contract with an application child, before its
// versions are read.
type amendableHead struct {
	ContractID     int64         `bun:"contract_id"`
	SchoolID       int64         `bun:"school_id"`
	RequestChildID int64         `bun:"request_child_id"`
	UpdatedAt      time.Time     `bun:"updated_at"`
	FirstFrom      calendar.Date `bun:"first_from,type:date"`
	NextNumber     int           `bun:"next_number"`
}

func amendableHeads(ctx context.Context, db bun.IDB, organizationID int64) ([]amendableHead, error) {
	var heads []amendableHead
	if err := db.NewRaw(`SELECT c.id AS contract_id, c.school_id, c.request_child_id, c.updated_at,
			(SELECT f.effective_from FROM care_contract.contract_versions AS f
				WHERE f.organization_id = c.organization_id AND f.contract_id = c.id
					AND f.version_number = 1) AS first_from,
			(SELECT MAX(m.version_number) + 1 FROM care_contract.contract_versions AS m
				WHERE m.organization_id = c.organization_id AND m.contract_id = c.id) AS next_number
		FROM care_contract.contracts AS c
		JOIN care_contract.contract_versions AS v ON v.organization_id = c.organization_id AND v.contract_id = c.id
			AND v.status = ?
		WHERE c.organization_id = ? AND c.status = ? AND c.request_child_id IS NOT NULL
		ORDER BY c.school_id, c.id`, carecontract.VersionEffective, organizationID, carecontract.StatusActive).Scan(ctx, &heads); err != nil {
		return nil, fmt.Errorf("care contract postgres: read active contracts: %w", err)
	}
	return heads, nil
}
