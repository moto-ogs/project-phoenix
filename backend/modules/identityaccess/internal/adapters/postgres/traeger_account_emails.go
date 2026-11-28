package postgres

import (
	"context"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"
)

// TraegerAccountEmails reads account addresses in a Träger transaction
// (#8215). It needs no school scope: the account row carries no tenant,
// and the Träger transaction of organizationID is required.
type TraegerAccountEmails struct{}

// TraegerAccountEmails reads the addresses of the active, not erased
// accounts among accountIDs in one statement.
func (TraegerAccountEmails) TraegerAccountEmails(ctx context.Context, organizationID int64, accountIDs []int64) (map[int64]string, error) {
	emails := map[int64]string{}
	if len(accountIDs) == 0 {
		return emails, nil
	}
	db, err := traegerRoleDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []accountRow
	if err := db.NewRaw(`SELECT id, email FROM auth.accounts
		WHERE id = ANY(?) AND active = TRUE AND personal_data_erased_at IS NULL`, pgdialect.Array(accountIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("identity access postgres: read Träger account addresses: %w", err)
	}
	for _, row := range rows {
		emails[row.ID] = row.Email
	}
	return emails, nil
}
