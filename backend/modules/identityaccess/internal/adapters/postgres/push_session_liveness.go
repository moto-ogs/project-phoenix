package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// pushSessionLivenessSQL answers, for every link, whether an un-rotated
// session alive at the bound instant still backs it. A bound link needs a
// live session of its family. An unbound link (legacy, no family) needs any
// live session of the account in its portal: a parent session at any school,
// a staff or school session at the link's school; unknown and empty portal
// scopes count for every portal. These are the predicates of
// has_live_token in platform.delivery_push_subscriptions, with the owner's
// session clock in place of NOW(). Bind order: link arrays, locked accounts,
// the instant twice.
const pushSessionLivenessSQL = `
	WITH "link" (subscription_id, account_id, tenant_id, portal, token_family_id) AS (
		SELECT * FROM unnest(?::BIGINT[], ?::BIGINT[], ?::BIGINT[], ?::TEXT[], ?::TEXT[])
	)
	SELECT "link".subscription_id,
		CASE
			WHEN NOT COALESCE("link".account_id = ANY(?), FALSE) THEN TRUE
			WHEN "link".token_family_id <> '' THEN EXISTS (
				SELECT 1 FROM auth.tokens AS "token"
				WHERE "token".account_id = "link".account_id
					AND "token".family_id = "link".token_family_id
					AND "token".rotated_at IS NULL AND "token".expiry > ?
			)
			ELSE EXISTS (
				SELECT 1 FROM auth.tokens AS "token"
				WHERE "token".account_id = "link".account_id
					AND "token".rotated_at IS NULL AND "token".expiry > ?
					AND (
						("link".portal = 'parent' AND "token".portal_scope IN ('parent', 'unknown', ''))
						OR ("link".portal = 'staff' AND "token".tenant_id = "link".tenant_id AND "token".portal_scope IN ('tenant', 'org', 'unknown', ''))
						OR ("link".portal = 'school' AND "token".tenant_id = "link".tenant_id AND "token".portal_scope IN ('school', 'unknown', ''))
					)
			)
		END AS live
	FROM "link"`

// ProtectedPushSubscriptionLinks reports which links are backed by a live session or
// protected by a concurrent account write. The caller holds the locks
// through the guarded delete in the same administrative transaction.
func (s *Store) ProtectedPushSubscriptionLinks(ctx context.Context, links []domain.PushSubscriptionLink, now time.Time) (map[int64]bool, domain.OperationStats, error) {
	if len(links) == 0 {
		return map[int64]bool{}, domain.OperationStats{}, nil
	}
	db, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	// Inserting a refresh token takes a key-share lock on its account
	// through the foreign key. Skip accounts with an in-flight login.
	// Read sessions in a subsequent statement so a login that committed
	// before our lock is visible under READ COMMITTED.
	started := time.Now()
	accountIDs := make([]int64, len(links))
	for i, link := range links {
		accountIDs[i] = link.AccountID
	}
	var lockedIDs []int64
	err = db.NewRaw(`SELECT id FROM auth.accounts WHERE id = ANY(?)
		ORDER BY id FOR UPDATE SKIP LOCKED`, pgdialect.Array(accountIDs)).Scan(ctx, &lockedIDs)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return nil, stats, fmt.Errorf("identity access postgres: lock push subscription accounts: %w", err)
	}
	ids := make([]int64, len(links))
	tenants := make([]int64, len(links))
	portals := make([]string, len(links))
	families := make([]string, len(links))
	for i, link := range links {
		ids[i], tenants[i] = link.SubscriptionID, link.TenantID
		portals[i], families[i] = link.Portal, link.TokenFamilyID
	}
	var rows []struct {
		SubscriptionID int64 `bun:"subscription_id"`
		Live           bool  `bun:"live"`
	}
	started = time.Now()
	err = db.NewRaw(pushSessionLivenessSQL,
		pgdialect.Array(ids), pgdialect.Array(accountIDs), pgdialect.Array(tenants),
		pgdialect.Array(portals), pgdialect.Array(families), pgdialect.Array(lockedIDs), now, now).
		Scan(ctx, &rows)
	stats.Queries++
	stats.StatementDuration += time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("identity access postgres: live push subscription links: %w", err)
	}
	protected := make(map[int64]bool, len(rows))
	for _, row := range rows {
		protected[row.SubscriptionID] = row.Live
	}
	return protected, stats, nil
}
