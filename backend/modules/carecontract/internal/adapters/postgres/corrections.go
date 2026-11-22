package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The persistence of the corrections of contracts from an import (#7767).
// Every statement runs in the Träger transaction and names the Träger in its
// own filter; none depends on the number of rows of the file.

// correctionSubjectsSQL reads the contracts a correction names, or every
// contract from an import, with the child of the newest version, the parties
// in their order and the first day a termination or withdrawal was received.
// Binds: the Träger, whether every contract from an import is read, the
// numbers of the contracts.
const correctionSubjectsSQL = `SELECT c.id AS contract_id, c.school_id, c.import_origin IS NOT NULL AS imported,
		c.concluded_at, COALESCE(c.conclusion_method, '') AS method, c.conclusion_date_unknown AS date_unknown,
		v.school_name, v.child_first_name, v.child_last_name,
		(SELECT MIN(n.received_on) FROM care_contract.contract_notices AS n
			WHERE n.organization_id = c.organization_id AND n.contract_id = c.id) AS first_notice_on,
		COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name) ORDER BY p.id)
			FROM care_contract.contract_parties AS p
			WHERE p.organization_id = c.organization_id AND p.contract_id = c.id), '[]'::jsonb)::text AS parties
	FROM care_contract.contracts AS c
	JOIN LATERAL (SELECT cv.school_name, cv.child_first_name, cv.child_last_name FROM care_contract.contract_versions AS cv
		WHERE cv.organization_id = c.organization_id AND cv.contract_id = c.id
		ORDER BY cv.version_number DESC LIMIT 1) AS v ON true
	WHERE c.organization_id = ? AND ((? AND c.import_origin IS NOT NULL) OR c.id = ANY(?))
	ORDER BY v.school_name, v.child_last_name, v.child_first_name, c.id`

// CorrectionSubjects reads the contracts with the given numbers, or with all
// set every contract from an import, by school and child. With lock it first
// holds each numbered contract until the transaction ends, so a correction
// stores what it read.
func (Store) CorrectionSubjects(ctx context.Context, organizationID int64, contractIDs []int64, all, lock bool) ([]ports.CorrectionSubject, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ContractID     int64          `bun:"contract_id"`
		SchoolID       int64          `bun:"school_id"`
		Imported       bool           `bun:"imported"`
		ConcludedAt    *time.Time     `bun:"concluded_at"`
		Method         string         `bun:"method"`
		DateUnknown    bool           `bun:"date_unknown"`
		SchoolName     string         `bun:"school_name"`
		ChildFirstName string         `bun:"child_first_name"`
		ChildLastName  string         `bun:"child_last_name"`
		FirstNoticeOn  *calendar.Date `bun:"first_notice_on,type:date"`
		Parties        string         `bun:"parties"`
	}
	if contractIDs == nil {
		contractIDs = []int64{}
	}
	if lock {
		// The locks come first, in a statement of their own: the read below
		// then starts after every correction that held one has committed and
		// sees its parties. A lock in the read itself would wait and still
		// answer the parties of its older snapshot.
		if _, err := db.ExecContext(ctx, `SELECT c.id FROM care_contract.contracts AS c
			WHERE c.organization_id = ? AND c.id = ANY(?) ORDER BY c.id FOR UPDATE`, organizationID, pgdialect.Array(contractIDs)); err != nil {
			return nil, fmt.Errorf("care contract postgres: lock the contracts of a correction: %w", err)
		}
	}
	if err := db.NewRaw(correctionSubjectsSQL, organizationID, all, pgdialect.Array(contractIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the contracts of a correction: %w", err)
	}
	subjects := make([]ports.CorrectionSubject, len(rows))
	for i, row := range rows {
		subjects[i] = ports.CorrectionSubject{ContractID: row.ContractID, SchoolID: row.SchoolID, SchoolName: row.SchoolName,
			ChildFirstName: row.ChildFirstName, ChildLastName: row.ChildLastName, Imported: row.Imported,
			ConcludedAt: row.ConcludedAt, Method: row.Method, DateUnknown: row.DateUnknown, FirstNoticeOn: row.FirstNoticeOn}
		if err := json.Unmarshal([]byte(row.Parties), &subjects[i].Parties); err != nil {
			return nil, fmt.Errorf("care contract postgres: read the parties of contract %d: %w", row.ContractID, err)
		}
	}
	return subjects, nil
}

// The statements of a correction. Each names the Träger and touches only a
// contract from an import; the party statements name the contract of each
// party once more, so no row reaches a party of another contract.
const (
	correctConclusionsSQL = `UPDATE care_contract.contracts AS c
		SET concluded_at = u.concluded_at, conclusion_method = u.method, conclusion_date_unknown = u.date_unknown
		FROM jsonb_to_recordset(?::jsonb) AS u(contract_id bigint, concluded_at timestamptz, method text, date_unknown boolean)
		WHERE c.organization_id = ? AND c.id = u.contract_id AND c.import_origin IS NOT NULL AND c.concluded_at IS NOT NULL`
	renamePartiesSQL = `UPDATE care_contract.contract_parties AS p
		SET first_name = u.first_name, last_name = u.last_name
		FROM jsonb_to_recordset(?::jsonb) AS u(contract_id bigint, id bigint, first_name text, last_name text)
		JOIN care_contract.contracts AS c ON c.id = u.contract_id AND c.import_origin IS NOT NULL
		WHERE p.organization_id = ? AND c.organization_id = p.organization_id AND p.contract_id = u.contract_id AND p.id = u.id`
	addPartiesSQL = `INSERT INTO care_contract.contract_parties (organization_id, contract_id, first_name, last_name)
		SELECT c.organization_id, c.id, u.first_name, u.last_name
		FROM jsonb_to_recordset(?::jsonb) AS u(position int, contract_id bigint, first_name text, last_name text)
		JOIN care_contract.contracts AS c ON c.organization_id = ? AND c.id = u.contract_id AND c.import_origin IS NOT NULL
		ORDER BY u.position`
)

// correctionRows are the rows of the three statements of a correction.
type correctionRows struct {
	conclusions []correctedConclusion
	renames     []correctedParty
	adds        []correctedParty
}

type correctedConclusion struct {
	ContractID  int64  `json:"contract_id"`
	ConcludedAt string `json:"concluded_at"`
	Method      string `json:"method"`
	DateUnknown bool   `json:"date_unknown"`
}

type correctedParty struct {
	Position   int    `json:"position"`
	ContractID int64  `json:"contract_id"`
	ID         int64  `json:"id"`
	FirstName  string `json:"first_name"`
	LastName   string `json:"last_name"`
}

func correctionRowsOf(corrections []ports.Correction) correctionRows {
	var rows correctionRows
	for _, correction := range corrections {
		if correction.Conclusion {
			rows.conclusions = append(rows.conclusions, correctedConclusion{ContractID: correction.ContractID,
				ConcludedAt: correction.ConcludedAt.UTC().Format(time.RFC3339Nano), Method: correction.Method, DateUnknown: correction.DateUnknown})
		}
		for _, rename := range correction.Renames {
			rows.renames = append(rows.renames, correctedParty{ContractID: correction.ContractID, ID: rename.ID,
				FirstName: rename.FirstName, LastName: rename.LastName})
		}
		for _, add := range correction.Adds {
			rows.adds = append(rows.adds, correctedParty{Position: len(rows.adds), ContractID: correction.ContractID,
				FirstName: add.FirstName, LastName: add.LastName})
		}
	}
	return rows
}

// ApplyCorrections stores the corrections: the conclusion of each contract
// that names one, the names of the parties that change and the further
// parties, in three statements. A contract or a party that is no longer what
// the correction read makes it ErrContractCorrectionChanged.
func (Store) ApplyCorrections(ctx context.Context, organizationID int64, corrections []ports.Correction) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	rows := correctionRowsOf(corrections)
	// Each statement names its SQL itself, so the tables it writes stay
	// readable from the call.
	if err := storeCorrection(rows.conclusions, len(rows.conclusions), func(encoded string) (sql.Result, error) {
		return db.ExecContext(ctx, correctConclusionsSQL, encoded, organizationID)
	}); err != nil {
		return err
	}
	if err := storeCorrection(rows.renames, len(rows.renames), func(encoded string) (sql.Result, error) {
		return db.ExecContext(ctx, renamePartiesSQL, encoded, organizationID)
	}); err != nil {
		return err
	}
	return storeCorrection(rows.adds, len(rows.adds), func(encoded string) (sql.Result, error) {
		return db.ExecContext(ctx, addPartiesSQL, encoded, organizationID)
	})
}

// storeCorrection runs one statement of a correction over its rows and
// demands that it stored every one of them.
func storeCorrection(rows any, count int, exec func(encoded string) (sql.Result, error)) error {
	if count == 0 {
		return nil
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		return fmt.Errorf("care contract postgres: encode a correction: %w", err)
	}
	result, err := exec(string(encoded))
	if err != nil {
		return fmt.Errorf("care contract postgres: store a correction: %w", err)
	}
	if stored, err := result.RowsAffected(); err != nil || int(stored) != count {
		return carecontract.ErrContractCorrectionChanged
	}
	return nil
}

// ContractCorrectionEvents lists the correction files of the Träger from the
// trail of the contracts they changed, newest first: one entry per file,
// account and instant.
func (Store) ContractCorrectionEvents(ctx context.Context, organizationID int64) ([]carecontract.ContractCorrectionEntry, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		File        string    `bun:"file"`
		AccountID   *int64    `bun:"account_id"`
		CorrectedAt time.Time `bun:"corrected_at"`
		Contracts   int       `bun:"contracts"`
	}
	if err := db.NewRaw(`SELECT e.details->>? AS file, e.account_id, e.created_at AS corrected_at, COUNT(*) AS contracts
		FROM care_contract.contract_events AS e
		WHERE e.organization_id = ? AND e.action = ? AND e.details->>? IS NOT NULL
		GROUP BY e.details->>?, e.account_id, e.created_at
		ORDER BY e.created_at DESC, file LIMIT 100`, ports.CorrectionFileDetail, organizationID, ports.ActionCorrect,
		ports.CorrectionFileDetail, ports.CorrectionFileDetail).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the corrections: %w", err)
	}
	entries := make([]carecontract.ContractCorrectionEntry, len(rows))
	for i, row := range rows {
		entries[i] = carecontract.ContractCorrectionEntry{File: row.File, AccountID: (*ident.ID)(row.AccountID),
			CorrectedAt: row.CorrectedAt, Contracts: row.Contracts}
	}
	return entries, nil
}

// maxShownCorrections bounds the corrections the page of a contract lists.
const maxShownCorrections = 20

// ContractCorrections reads the corrections of one contract out of its
// trail, newest first.
func (Store) ContractCorrections(ctx context.Context, organizationID, contractID int64) ([]carecontract.ContractCorrection, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		CorrectedAt time.Time `bun:"created_at"`
		Details     string    `bun:"details"`
	}
	if err := db.NewRaw(`SELECT e.created_at, e.details::text AS details FROM care_contract.contract_events AS e
		WHERE e.organization_id = ? AND e.contract_id = ? AND e.action = ?
		ORDER BY e.created_at DESC, e.id DESC LIMIT ?`, organizationID, contractID, ports.ActionCorrect, maxShownCorrections).
		Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the corrections of a contract: %w", err)
	}
	corrections := make([]carecontract.ContractCorrection, len(rows))
	for i, row := range rows {
		var details struct {
			File     string                                `json:"correction_file"`
			Evidence string                                `json:"evidence"`
			Changes  []string                              `json:"changes"`
			Before   carecontract.ContractCorrectionValues `json:"before"`
			After    carecontract.ContractCorrectionValues `json:"after"`
		}
		if err := json.Unmarshal([]byte(row.Details), &details); err != nil {
			return nil, fmt.Errorf("care contract postgres: read a correction of contract %d: %w", contractID, err)
		}
		corrections[i] = carecontract.ContractCorrection{CorrectedAt: row.CorrectedAt, File: details.File, Evidence: details.Evidence,
			Changes: nonNil(details.Changes), Before: details.Before, After: details.After}
		corrections[i].Before.Parties, corrections[i].After.Parties = nonNil(details.Before.Parties), nonNil(details.After.Parties)
	}
	return corrections, nil
}
