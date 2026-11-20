package behavior_test

import (
	"context"
	"testing"
	"time"

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

// liveSession is one unexpired refresh session of an account.
type liveSession struct {
	ID         int64     `bun:"id"`
	Expiry     time.Time `bun:"expiry"`
	Mobile     bool      `bun:"mobile"`
	Identifier *string   `bun:"identifier"`
	CreatedAt  time.Time `bun:"created_at"`
}

// liveSessions lists the unexpired refresh sessions of the account in the
// given school.
func liveSessions(ctx context.Context, db bun.IDB, tenantID, accountID int64) ([]liveSession, error) {
	var sessions []liveSession
	err := db.NewRaw(`SELECT id, expiry, mobile, identifier, created_at FROM auth.tokens
		WHERE account_id = ? AND tenant_id = ? AND expiry > NOW() ORDER BY id`, accountID, tenantID).Scan(ctx, &sessions)
	return sessions, err
}
