package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Vertretungspool (#4709, ADR 0252). A school reads and blocks through
// the functions of the migration, which answer only the school of the
// tenant transaction; the Träger reads and lifts in its own transaction.

const (
	poolBlockOverlapConstraint = "ex_workforce_staff_pool_blocks_overlap"
	sqlStateNoDataFound        = "P0002"
	sqlStateExclusionViolation = "23P01"
	// sqlStatePoolSpringerBusy is raised by workforce.pool_block for a
	// Springer with a shift at one of its Einsatzorte at that time.
	sqlStatePoolSpringerBusy = "WFP01"
)

type poolSpringerRow struct {
	StaffRecordID int64          `bun:"staff_record_id"`
	FirstName     string         `bun:"first_name"`
	LastName      string         `bun:"last_name"`
	PoolFrom      calendar.Date  `bun:"pool_from"`
	PoolUntil     *calendar.Date `bun:"pool_until"`
}

func (r poolSpringerRow) toDomain() domain.PoolSpringer {
	springer := domain.PoolSpringer{RecordID: r.StaffRecordID, FirstName: r.FirstName, LastName: r.LastName, PoolFrom: r.PoolFrom}
	if r.PoolUntil != nil {
		springer.PoolUntil = *r.PoolUntil
	}
	return springer
}

type poolBlockRow struct {
	ID            *int64        `bun:"id"`
	StaffRecordID int64         `bun:"staff_record_id"`
	SchoolID      int64         `bun:"school_id"`
	SchoolName    *string       `bun:"school_name"`
	Own           bool          `bun:"own"`
	Date          calendar.Date `bun:"date"`
	StartTime     string        `bun:"start_time"`
	EndTime       string        `bun:"end_time"`
	Lifted        bool          `bun:"lifted"`
}

func (r poolBlockRow) toDomain() domain.PoolBlock {
	block := domain.PoolBlock{RecordID: r.StaffRecordID, SchoolID: r.SchoolID, Own: r.Own, Date: r.Date,
		Start: shortWallClock(r.StartTime), End: shortWallClock(r.EndTime), Lifted: r.Lifted}
	if r.ID != nil {
		block.ID = *r.ID
	}
	if r.SchoolName != nil {
		block.SchoolName = *r.SchoolName
	}
	return block
}

type poolProofRow struct {
	StaffRecordID     int64   `bun:"staff_record_id"`
	TypeName          string  `bun:"type_name"`
	Mandatory         bool    `bun:"mandatory"`
	Held              bool    `bun:"held"`
	ExpiresOn         *string `bun:"expires_on"`
	ReminderLeadWeeks int     `bun:"reminder_lead_weeks"`
}

func (r poolProofRow) toDomain() domain.PoolProof {
	proof := domain.PoolProof{RecordID: r.StaffRecordID, TypeName: r.TypeName, Mandatory: r.Mandatory, Held: r.Held,
		ReminderLeadWeeks: r.ReminderLeadWeeks}
	if r.ExpiresOn != nil {
		proof.ExpiresOn = calendar.Date(*r.ExpiresOn)
	}
	return proof
}

// shortWallClock cuts a TIME value to HH:MM.
func shortWallClock(value string) string {
	if len(value) >= 5 {
		return value[:5]
	}
	return value
}

func mapRows[R interface{ toDomain() D }, D any](rows []R) []D {
	result := make([]D, 0, len(rows))
	for _, row := range rows {
		result = append(result, row.toDomain())
	}
	return result
}

// SchoolPoolAvailable reports whether the Träger of the school keeps its
// staff in moto, so the school has a Vertretungspool at all.
func (s *TraegerStaffStore) SchoolPoolAvailable(ctx context.Context) (bool, error) {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return false, err
	}
	var available bool
	if err := db.NewRaw(`SELECT workforce.pool_school_organization() IS NOT NULL`).Scan(ctx, &available); err != nil {
		return false, fmt.Errorf("workforce postgres: read the pool of the school: %w", err)
	}
	return available, nil
}

// SchoolPoolSpringers lists the Springer of the school's Träger whose pool
// contract covers a day in [from, to].
func (s *TraegerStaffStore) SchoolPoolSpringers(ctx context.Context, from, to calendar.Date) ([]domain.PoolSpringer, error) {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []poolSpringerRow
	if err := db.NewRaw(`SELECT staff_record_id, first_name, last_name, pool_from, pool_until FROM workforce.pool_springers(?, ?)`,
		from, to).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list pool springers: %w", err)
	}
	return mapRows[poolSpringerRow, domain.PoolSpringer](rows), nil
}

// SchoolPoolBlocks lists the blocks of the Springer in [from, to] as the
// school of the tenant transaction sees them.
func (s *TraegerStaffStore) SchoolPoolBlocks(ctx context.Context, recordIDs []int64, from, to calendar.Date) ([]domain.PoolBlock, error) {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []poolBlockRow
	if err := db.NewRaw(`SELECT id, staff_record_id, school_id, school_name, own, date, start_time::text AS start_time,
		end_time::text AS end_time, lifted FROM workforce.pool_blocks(?, ?, ?) ORDER BY date, start_time`,
		pgdialect.Array(recordIDs), from, to).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list pool blocks: %w", err)
	}
	return mapRows[poolBlockRow, domain.PoolBlock](rows), nil
}

// SchoolPoolProofs reads the status of the Nachweise of the Springer.
func (s *TraegerStaffStore) SchoolPoolProofs(ctx context.Context, recordIDs []int64) ([]domain.PoolProof, error) {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []poolProofRow
	if err := db.NewRaw(`SELECT staff_record_id, type_name, mandatory, held, expires_on, reminder_lead_weeks
		FROM workforce.pool_proof_status(?)`, pgdialect.Array(recordIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read pool proof status: %w", err)
	}
	return mapRows[poolProofRow, domain.PoolProof](rows), nil
}

// BlockPoolSpringer blocks a Springer for the school of the tenant
// transaction. A person who is no Springer that day is
// ErrPoolSpringerNotFound, an overlap with a live block ErrPoolBlockTaken.
func (s *TraegerStaffStore) BlockPoolSpringer(ctx context.Context, block domain.PoolBlock, accountID int64) (int64, error) {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return 0, err
	}
	var id int64
	err = db.NewRaw(`SELECT workforce.pool_block(?, ?, ?::time, ?::time, ?)`, block.RecordID, block.Date, block.Start, block.End, accountID).Scan(ctx, &id)
	if pgErr, ok := errors.AsType[pgdriver.Error](err); ok {
		switch {
		case pgErr.Field('C') == sqlStateNoDataFound:
			return 0, workforce.ErrPoolSpringerNotFound
		case pgErr.Field('C') == sqlStatePoolSpringerBusy:
			return 0, workforce.ErrPoolSpringerBusy
		case pgErr.Field('C') == sqlStateExclusionViolation && pgErr.Field('n') == poolBlockOverlapConstraint:
			return 0, workforce.ErrPoolBlockTaken
		}
	}
	if err != nil {
		return 0, fmt.Errorf("workforce postgres: block pool springer: %w", err)
	}
	return id, nil
}

// LiftSchoolPoolBlock lifts a live block of the school of the tenant
// transaction; a block it does not hold is ErrPoolBlockNotFound.
func (s *TraegerStaffStore) LiftSchoolPoolBlock(ctx context.Context, blockID, accountID int64) error {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	var lifted bool
	if err := db.NewRaw(`SELECT workforce.pool_lift(?, ?)`, blockID, accountID).Scan(ctx, &lifted); err != nil {
		return fmt.Errorf("workforce postgres: lift pool block: %w", err)
	}
	if !lifted {
		return workforce.ErrPoolBlockNotFound
	}
	return nil
}

// TraegerPoolSpringers lists the Springer of the Träger whose pool contract
// covers a day in [from, to].
func (s *TraegerStaffStore) TraegerPoolSpringers(ctx context.Context, organizationID int64, from, to calendar.Date) ([]domain.PoolSpringer, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []poolSpringerRow
	if err := db.NewRaw(`SELECT record.id AS staff_record_id, record.first_name, record.last_name, min(contract.starts_on) AS pool_from,
			CASE WHEN bool_or(contract.ends_on IS NULL) THEN NULL ELSE max(contract.ends_on) END AS pool_until
		FROM workforce.staff_records AS record
		JOIN workforce.staff_contracts AS contract
			ON contract.organization_id = record.organization_id AND contract.staff_record_id = record.id AND contract.pool
		WHERE record.organization_id = ? AND contract.starts_on <= ? AND (contract.ends_on IS NULL OR contract.ends_on >= ?)
		GROUP BY record.id, record.first_name, record.last_name`, organizationID, to, from).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list pool springers of the Träger: %w", err)
	}
	return mapRows[poolSpringerRow, domain.PoolSpringer](rows), nil
}

// TraegerPoolBlocks lists the live blocks of the Springer in [from, to];
// the caller names the schools.
func (s *TraegerStaffStore) TraegerPoolBlocks(ctx context.Context, organizationID int64, recordIDs []int64, from, to calendar.Date) ([]domain.PoolBlock, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []poolBlockRow
	if err := db.NewRaw(`SELECT id, staff_record_id, school_id, NULL AS school_name, false AS own, date,
			start_time::text AS start_time, end_time::text AS end_time, false AS lifted
		FROM workforce.staff_pool_blocks
		WHERE organization_id = ? AND staff_record_id = ANY(?) AND date BETWEEN ? AND ? AND lifted_at IS NULL
		ORDER BY date, start_time`, organizationID, pgdialect.Array(recordIDs), from, to).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list pool blocks of the Träger: %w", err)
	}
	return mapRows[poolBlockRow, domain.PoolBlock](rows), nil
}

// TraegerPoolBlockSites lists every school that ever blocked one of the
// Springer, for the access log of the Träger's read (ADR 0089 section 6).
func (s *TraegerStaffStore) TraegerPoolBlockSites(ctx context.Context, organizationID int64, recordIDs []int64) ([]domain.PoolBlockSite, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		SchoolID      int64 `bun:"school_id"`
		StaffRecordID int64 `bun:"staff_record_id"`
	}
	if err := db.NewRaw(`SELECT DISTINCT school_id, staff_record_id FROM workforce.staff_pool_blocks
		WHERE organization_id = ? AND staff_record_id = ANY(?)`, organizationID, pgdialect.Array(recordIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list pool block schools: %w", err)
	}
	sites := make([]domain.PoolBlockSite, 0, len(rows))
	for _, row := range rows {
		sites = append(sites, domain.PoolBlockSite{SchoolID: row.SchoolID, RecordID: row.StaffRecordID})
	}
	return sites, nil
}

// TraegerPoolProofs reads the status of the Nachweise of the Springer in
// the Träger transaction, like the school function does.
func (s *TraegerStaffStore) TraegerPoolProofs(ctx context.Context, organizationID int64, recordIDs []int64) ([]domain.PoolProof, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []poolProofRow
	if err := db.NewRaw(`SELECT record.id AS staff_record_id, kind.name AS type_name, kind.mandatory, proof.id IS NOT NULL AS held,
			proof.expires_on::text AS expires_on, kind.reminder_lead_weeks
		FROM workforce.staff_records AS record
		JOIN workforce.staff_proof_types AS kind ON kind.organization_id = record.organization_id AND kind.archived_at IS NULL
		LEFT JOIN workforce.staff_proofs AS proof
			ON proof.organization_id = record.organization_id AND proof.staff_record_id = record.id AND proof.type_id = kind.id
		WHERE record.organization_id = ? AND record.id = ANY(?) AND (kind.mandatory OR proof.id IS NOT NULL)
		ORDER BY record.id, kind.sort_order, kind.id`, organizationID, pgdialect.Array(recordIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read pool proof status of the Träger: %w", err)
	}
	return mapRows[poolProofRow, domain.PoolProof](rows), nil
}

// LiftTraegerPoolBlock lifts a live block of the Träger for the
// Personalverwaltung and returns the school and the Springer of the block.
func (s *TraegerStaffStore) LiftTraegerPoolBlock(ctx context.Context, organizationID, blockID, accountID int64) (domain.PoolBlockSite, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return domain.PoolBlockSite{}, err
	}
	var rows []struct {
		SchoolID      int64 `bun:"school_id"`
		StaffRecordID int64 `bun:"staff_record_id"`
	}
	if err := db.NewRaw(`UPDATE workforce.staff_pool_blocks SET lifted_at = now(), lifted_by_account_id = ?, lifted_by_traeger = true
		WHERE organization_id = ? AND id = ? AND lifted_at IS NULL RETURNING school_id, staff_record_id`,
		accountID, organizationID, blockID).Scan(ctx, &rows); err != nil {
		return domain.PoolBlockSite{}, fmt.Errorf("workforce postgres: lift pool block of the Träger: %w", err)
	}
	if len(rows) == 0 {
		return domain.PoolBlockSite{}, workforce.ErrPoolBlockNotFound
	}
	return domain.PoolBlockSite{SchoolID: rows[0].SchoolID, RecordID: rows[0].StaffRecordID}, nil
}
