package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun/driver/pgdriver"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
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
