package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const accountParentPushSubscriptionsVersion = "20261118201328"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     accountParentPushSubscriptionsVersion,
		Description: "Geräte für Elternbenachrichtigungen am Konto speichern",
		DependsOn:   []string{deliveryPushViewWithoutSessionClockVersion},
	})
	Migrations.MustRegister(accountParentPushSubscriptionsUp, accountParentPushSubscriptionsDown)
}

// Only a parent device can have no school. Existing school-bound parent
// registrations remain readable and are replaced when the device next syncs.
// The projection assigns a school for delivery, not for device ownership.
func accountParentPushSubscriptionsUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `
		ALTER TABLE iot.push_subscriptions
			ALTER COLUMN tenant_id DROP NOT NULL,
			ADD CONSTRAINT push_subscription_school_required CHECK (tenant_id IS NOT NULL OR portal = 'parent');
		CREATE UNIQUE INDEX push_subscription_parent_device
			ON iot.push_subscriptions (endpoint) WHERE portal = 'parent' AND tenant_id IS NULL;

		CREATE POLICY tenant_read_account_parent_push ON iot.push_subscriptions
			FOR SELECT TO phoenix_tenant
			USING (tenant_id IS NULL AND portal = 'parent' AND EXISTS (
				SELECT 1 FROM auth.account_tenants AS membership
				JOIN auth.account_roles AS assignment USING (tenant_id, account_id)
				JOIN auth.roles AS role ON role.id = assignment.role_id
				WHERE membership.account_id = push_subscriptions.account_id
				  AND membership.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint
				  AND membership.status = 'active'
				  AND LOWER(role.name) = 'guardian'
			));

		CREATE OR REPLACE VIEW platform.delivery_push_subscriptions
		WITH (security_invoker = true, security_barrier = true) AS
		SELECT device.id, "push_subscription".tenant_id, "push_subscription".account_id, device.portal, device.endpoint,
			device.p256dh, device.auth, device.user_agent, device.created_at, device.updated_at, device.token_family_id
	`+deliveryPushViewEligibility+`
		FROM iot.push_subscriptions AS device
		LEFT JOIN auth.account_tenants AS "account_tenant"
			ON "account_tenant".account_id = device.account_id
			AND (device.tenant_id IS NULL OR "account_tenant".tenant_id = device.tenant_id)
		CROSS JOIN LATERAL (
			SELECT device.account_id, COALESCE(device.tenant_id, "account_tenant".tenant_id) AS tenant_id
		) AS "push_subscription"
		LEFT JOIN auth.accounts AS "account" ON "account".id = device.account_id;
	`)
	if err != nil {
		return fmt.Errorf("enable account-level parent push subscriptions: %w", err)
	}
	return nil
}

func accountParentPushSubscriptionsDown(ctx context.Context, db *bun.DB) error {
	// Restore school-bound devices where the old model can represent them.
	// Accounts without an active guardian school cannot be restored by it.
	_, err := db.ExecContext(ctx, `
		INSERT INTO iot.push_subscriptions
			(tenant_id, account_id, portal, endpoint, p256dh, auth, user_agent, created_at, updated_at, token_family_id)
		SELECT membership.tenant_id, device.account_id, device.portal, device.endpoint,
			device.p256dh, device.auth, device.user_agent, device.created_at, device.updated_at, device.token_family_id
		FROM iot.push_subscriptions AS device
		JOIN auth.account_tenants AS membership ON membership.account_id = device.account_id AND membership.status = 'active'
		WHERE device.tenant_id IS NULL AND EXISTS (
			SELECT 1 FROM auth.account_roles AS assignment
			JOIN auth.roles AS role ON role.id = assignment.role_id
			WHERE assignment.account_id = membership.account_id
			  AND assignment.tenant_id = membership.tenant_id
			  AND LOWER(role.name) = 'guardian'
		)
		ON CONFLICT (tenant_id, portal, endpoint) DO NOTHING;
		DELETE FROM iot.push_subscriptions WHERE tenant_id IS NULL;
		DROP POLICY tenant_read_account_parent_push ON iot.push_subscriptions;
		DROP INDEX iot.push_subscription_parent_device;
		ALTER TABLE iot.push_subscriptions
			DROP CONSTRAINT push_subscription_school_required,
			ALTER COLUMN tenant_id SET NOT NULL;
	`+deliveryPushViewColumns+deliveryPushViewSources)
	if err != nil {
		return fmt.Errorf("restore school-level parent push subscriptions: %w", err)
	}
	return nil
}

// The migration checker resolves SQL fragments within one file. Both
// view versions use these same eligibility expressions.
const deliveryPushViewColumns = `
	CREATE OR REPLACE VIEW platform.delivery_push_subscriptions
	WITH (security_invoker = true, security_barrier = true) AS
	SELECT
		"push_subscription".*` + deliveryPushViewEligibility

const deliveryPushViewEligibility = `,
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

const deliveryPushViewSources = `
	FROM iot.push_subscriptions AS "push_subscription"
	LEFT JOIN auth.accounts AS "account" ON "account".id = "push_subscription".account_id
	LEFT JOIN auth.account_tenants AS "account_tenant"
		ON "account_tenant".account_id = "push_subscription".account_id
		AND "account_tenant".tenant_id = "push_subscription".tenant_id;`
