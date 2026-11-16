package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun/driver/pgdriver"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The employment the first block of a Springer creates (#7173, ADR 0251),
// through the functions of the migration that answer only the school of the
// tenant transaction.

type poolSpringerIdentityRow struct {
	AccountID      *int64 `bun:"account_id"`
	FirstName      string `bun:"first_name"`
	LastName       string `bun:"last_name"`
	MembershipID   *int64 `bun:"membership_id"`
	MembershipLive *bool  `bun:"membership_live"`
	ViaPool        *bool  `bun:"via_pool"`
}

// PoolSpringerIdentity locks the record and reads the Springer's account,
// names and Einsatzort at the school; found is false for no Springer of the
// school's Träger.
func (s *TraegerStaffStore) PoolSpringerIdentity(ctx context.Context, recordID int64) (domain.PoolSpringerIdentity, bool, error) {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return domain.PoolSpringerIdentity{}, false, err
	}
	var rows []poolSpringerIdentityRow
	if err := db.NewRaw(`SELECT account_id, first_name, last_name, membership_id, membership_live, via_pool
		FROM workforce.pool_springer_identity(?)`, recordID).Scan(ctx, &rows); err != nil {
		return domain.PoolSpringerIdentity{}, false, fmt.Errorf("workforce postgres: pool springer identity: %w", err)
	}
	if len(rows) == 0 {
		return domain.PoolSpringerIdentity{}, false, nil
	}
	row := rows[0]
	identity := domain.PoolSpringerIdentity{FirstName: row.FirstName, LastName: row.LastName}
	if row.AccountID != nil {
		identity.AccountID = *row.AccountID
	}
	if row.MembershipID != nil {
		identity.MembershipID = *row.MembershipID
	}
	identity.MembershipLive = row.MembershipLive != nil && *row.MembershipLive
	identity.ViaPool = row.ViaPool != nil && *row.ViaPool
	return identity, true, nil
}

// LinkPoolEmployment links the employment as an Einsatzort of the record.
// A record that is no Springer or an employment that is not live at the
// school is ErrPoolSpringerNotFound.
func (s *TraegerStaffStore) LinkPoolEmployment(ctx context.Context, recordID, staffID, accountID int64) error {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	var linked bool
	err = db.NewRaw(`SELECT workforce.pool_link(?, ?, ?)`, recordID, staffID, accountID).Scan(ctx, &linked)
	if pgErr, ok := errors.AsType[pgdriver.Error](err); ok && pgErr.Field('C') == sqlStateNoDataFound {
		return workforce.ErrPoolSpringerNotFound
	}
	if err != nil {
		return fmt.Errorf("workforce postgres: link pool employment: %w", err)
	}
	return nil
}

// The end of a Springer's employment after the last block at the school
// (#7197, ADR 0252).

type springerExitRow struct {
	RecordID       int64         `bun:"staff_record_id"`
	StaffID        int64         `bun:"staff_id"`
	LastDay        calendar.Date `bun:"last_day"`
	ActorAccountID *int64        `bun:"actor_account_id"`
	ActorStaffID   *int64        `bun:"actor_staff_id"`
}

func (r springerExitRow) toExit(schoolID int64) workforce.SpringerExit {
	exit := workforce.SpringerExit{TenantID: schoolID, RecordID: r.RecordID, StaffID: r.StaffID, LastBlockDay: r.LastDay}
	if r.ActorAccountID != nil && r.ActorStaffID != nil {
		exit.ActorAccountID, exit.ActorStaffID = *r.ActorAccountID, *r.ActorStaffID
	}
	return exit
}

// DueSpringerExits lists the pool's live employments at the school whose
// last block lies before today.
func (s *TraegerStaffStore) DueSpringerExits(ctx context.Context, today calendar.Date) ([]workforce.SpringerExit, error) {
	return s.springerExits(ctx, today, nil)
}

// LockSpringerExit locks the record and reads its exit at the school again.
func (s *TraegerStaffStore) LockSpringerExit(ctx context.Context, recordID int64, today calendar.Date) (workforce.SpringerExit, bool, error) {
	if recordID <= 0 {
		return workforce.SpringerExit{}, false, errors.New("workforce postgres: the record of a Springer exit is required")
	}
	exits, err := s.springerExits(ctx, today, &recordID)
	if err != nil || len(exits) == 0 {
		return workforce.SpringerExit{}, false, err
	}
	return exits[0], true, nil
}

func (s *TraegerStaffStore) springerExits(ctx context.Context, today calendar.Date, recordID *int64) ([]workforce.SpringerExit, error) {
	if today == "" {
		return nil, errors.New("workforce postgres: the day of the Springer exits is required")
	}
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []springerExitRow
	if err := db.NewRaw(`SELECT staff_record_id, staff_id, last_day, actor_account_id, actor_staff_id
		FROM workforce.pool_due_exits(?, ?)`, today, recordID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: due springer exits: %w", err)
	}
	exits := make([]workforce.SpringerExit, 0, len(rows))
	for _, row := range rows {
		exits = append(exits, row.toExit(schoolID))
	}
	return exits, nil
}

// RecordSpringerExit writes the end into the record's trail.
func (s *TraegerStaffStore) RecordSpringerExit(ctx context.Context, exit workforce.SpringerExit) error {
	if exit.RecordID <= 0 || exit.ActorAccountID <= 0 {
		return errors.New("workforce postgres: record and actor of a Springer exit are required")
	}
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	var written bool
	if err := db.NewRaw(`SELECT workforce.pool_ended(?, ?)`, exit.RecordID, exit.ActorAccountID).Scan(ctx, &written); err != nil {
		return fmt.Errorf("workforce postgres: record springer exit: %w", err)
	}
	if !written {
		return workforce.ErrPoolSpringerNotFound
	}
	return nil
}
