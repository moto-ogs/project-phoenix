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

const deliveryPushViewColumns = `
	CREATE OR REPLACE VIEW platform.delivery_push_subscriptions
	WITH (security_invoker = true, security_barrier = true) AS
	SELECT
		"push_subscription".*,
		COALESCE("account".active, FALSE) AS account_active,
		COALESCE("account_tenant".status = 'active', FALSE) AS tenant_active,
		EXISTS (
			SELECT 1
			FROM auth.account_roles AS "staff_account_role"
			INNER JOIN auth.roles AS "staff_role" ON "staff_role".id = "staff_account_role".role_id
			WHERE "staff_account_role".account_id = "push_subscription".account_id
				AND "staff_account_role".tenant_id = "push_subscription".tenant_id
				AND LOWER("staff_role".name) <> 'guardian'
		) AS has_staff_role,
		EXISTS (
			SELECT 1
			FROM auth.account_roles AS "school_account_role"
			INNER JOIN auth.roles AS "school_role" ON "school_role".id = "school_account_role".role_id
			WHERE "school_account_role".account_id = "push_subscription".account_id
				AND "school_account_role".tenant_id = "push_subscription".tenant_id
				AND (("school_role".is_system
					AND LOWER(BTRIM("school_role".name)) = 'lehrkraft')
					OR "school_role".school_portal)
		) AS has_school_role,
		EXISTS (
			SELECT 1
			FROM auth.account_roles AS "guardian_account_role"
			INNER JOIN auth.roles AS "guardian_role" ON "guardian_role".id = "guardian_account_role".role_id
			WHERE "guardian_account_role".account_id = "push_subscription".account_id
				AND "guardian_account_role".tenant_id = "push_subscription".tenant_id
				AND LOWER("guardian_role".name) = 'guardian'
		) AS has_guardian_role,
		(
			EXISTS (
				SELECT 1
				FROM auth.account_roles AS "admin_account_role"
				INNER JOIN auth.roles AS "admin_role" ON "admin_role".id = "admin_account_role".role_id
				LEFT JOIN auth.role_permissions AS "role_permission" ON "role_permission".role_id = "admin_account_role".role_id
				LEFT JOIN auth.permissions AS "permission" ON "permission".id = "role_permission".permission_id
				WHERE "admin_account_role".account_id = "push_subscription".account_id
					AND "admin_account_role".tenant_id = "push_subscription".tenant_id
					AND (
						LOWER("admin_role".name) = 'admin'
						OR ("permission".resource = 'admin' AND "permission".action = '*')
						OR ("permission".resource = '*' AND "permission".action = '*')
					)
			)
		) AS effective_admin,
		COALESCE(ARRAY(
			SELECT "child_link".student_id
			FROM users.student_guardian_relationships AS "child_link"
			INNER JOIN auth.guardian_student_access AS "child_access"
				ON "child_access".tenant_id = "child_link".tenant_id
				AND "child_access".relationship_id = "child_link".id
			INNER JOIN users.guardian_profiles AS "child_guardian"
				ON "child_guardian".id = "child_link".guardian_profile_id
			WHERE "child_link".tenant_id = "push_subscription".tenant_id
				AND "child_guardian".account_id = "push_subscription".account_id
				AND "child_access".permissions @> '{"parent_portal.access": true}'::jsonb
		), '{}'::BIGINT[]) AS guardian_student_ids`

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

const deliveryPushViewSources = `
	FROM iot.push_subscriptions AS "push_subscription"
	LEFT JOIN auth.accounts AS "account" ON "account".id = "push_subscription".account_id
	LEFT JOIN auth.account_tenants AS "account_tenant"
		ON "account_tenant".account_id = "push_subscription".account_id
		AND "account_tenant".tenant_id = "push_subscription".tenant_id;`

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
