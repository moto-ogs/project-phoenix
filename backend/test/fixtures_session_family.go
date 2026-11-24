package test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// CreateTestSessionFamily stores a live refresh session for the account and
// returns its family. The production router accepts an access token only
// while its family lives (#5194). tenantID is the session's school; scope is
// the access token's scope ("" for the tenant portal).
func CreateTestSessionFamily(tb testing.TB, db *bun.DB, accountID, tenantID int64, scope string) string {
	tb.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	portalScope := scope
	if portalScope == "" {
		portalScope = "tenant"
	}
	token := &TokenFixture{
		TenantID:    tenantID,
		AccountID:   accountID,
		Token:       fmt.Sprintf("test-session-%d", uniqueFixtureSuffix()),
		Expiry:      time.Now().Add(time.Hour),
		FamilyID:    fmt.Sprintf("family-session-%d", uniqueFixtureSuffix()),
		PortalScope: portalScope,
	}
	insertTokenFixture(tb, ctx, db, token)
	return token.FamilyID
}

// CreateTestTraegerSessionFamily stores a live refresh session of the Träger
// portal and returns its family: such a session names its Träger and no
// school (chk_tokens_session_owner). The row dies with the test's clone.
func CreateTestTraegerSessionFamily(tb testing.TB, db *bun.DB, accountID, organizationID int64) string {
	tb.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	family := fmt.Sprintf("family-session-%d", uniqueFixtureSuffix())
	_, err := db.ExecContext(ctx, `INSERT INTO auth.tokens (account_id, token, expiry, portal_scope, organization_id, family_id)
		VALUES (?, ?, NOW() + INTERVAL '1 hour', 'org', ?, ?)`,
		accountID, TokenHash(tb, db, fmt.Sprintf("test-session-%d", uniqueFixtureSuffix())), organizationID, family)
	require.NoError(tb, err, "Failed to create test Träger session")
	return family
}
