package account_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// storedAccount is the account row as persisted, read without the
// administration boundary.
type storedAccount struct {
	Email    string
	Username string
	Active   bool
}

func readStoredAccount(t *testing.T, ctx context.Context, db bun.IDB, accountID int64) storedAccount {
	t.Helper()
	var row struct {
		Email    string  `bun:"email"`
		Username *string `bun:"username"`
		Active   bool    `bun:"active"`
	}
	require.NoError(t, db.NewRaw("SELECT email, username, active FROM auth.accounts WHERE id = ?", accountID).Scan(ctx, &row))
	stored := storedAccount{Email: row.Email, Active: row.Active}
	if row.Username != nil {
		stored.Username = *row.Username
	}
	return stored
}
