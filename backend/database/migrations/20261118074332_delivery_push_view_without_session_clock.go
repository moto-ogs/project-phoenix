package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const deliveryPushViewWithoutSessionClockVersion = "20261118074332"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     deliveryPushViewWithoutSessionClockVersion,
		Description: "Ungenutzte Sitzungsfrist aus der Push-Sicht entfernen (#7383)",
		DependsOn:   []string{schoolPortalRolesVersion},
	})
	Migrations.MustRegister(deliveryPushViewWithoutSessionClockUp, deliveryPushViewWithoutSessionClockDown)
}

const deliveryPushViewSessionLiveness = `,
		CASE
			WHEN "push_subscription".token_family_id <> '' THEN EXISTS (
				SELECT 1 FROM auth.tokens AS "token"
				WHERE "token".account_id = "push_subscription".account_id
					AND "token".family_id = "push_subscription".token_family_id
					AND "token".rotated_at IS NULL AND "token".expiry > NOW()
			)
			ELSE EXISTS (
				SELECT 1 FROM auth.tokens AS "token"
				WHERE "token".account_id = "push_subscription".account_id
					AND "token".rotated_at IS NULL AND "token".expiry > NOW()
					AND (
						("push_subscription".portal = 'parent' AND "token".portal_scope IN ('parent', 'unknown', ''))
						OR ("push_subscription".portal = 'staff' AND "token".tenant_id = "push_subscription".tenant_id AND "token".portal_scope IN ('tenant', 'org', 'unknown', ''))
						OR ("push_subscription".portal = 'school' AND "token".tenant_id = "push_subscription".tenant_id AND "token".portal_scope IN ('school', 'unknown', ''))
					)
			)
		END AS has_live_token`

func deliveryPushViewWithoutSessionClockUp(ctx context.Context, db *bun.DB) error {
	// PostgreSQL can append columns to a view but cannot drop them in place.
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, `
			DROP VIEW platform.delivery_push_subscriptions;
		`+deliveryPushViewColumns+deliveryPushViewSources+`
			GRANT SELECT ON platform.delivery_push_subscriptions TO phoenix_tenant;
		`)
		if err != nil {
			return fmt.Errorf("remove the unused session column from delivery push subscriptions: %w", err)
		}
		return nil
	})
}

func deliveryPushViewWithoutSessionClockDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, deliveryPushViewColumns+deliveryPushViewSessionLiveness+deliveryPushViewSources); err != nil {
		return fmt.Errorf("restore the delivery push subscriptions session column: %w", err)
	}
	return nil
}
