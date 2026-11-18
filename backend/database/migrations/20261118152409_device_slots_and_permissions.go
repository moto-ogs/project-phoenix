package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const deviceSlotsAndPermissionsVersion = "20261118152409"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     deviceSlotsAndPermissionsVersion,
		Description: "Geräteplätze je Schule und eigene Geräterechte devices:read und devices:manage statt iot:* (#2312)",
		DependsOn:   []string{demoNeighbourAttendancePolicyVersion},
	})
	Migrations.MustRegister(deviceSlotsAndPermissionsUp, deviceSlotsAndPermissionsDown)
}

// deviceSlotsAndPermissionsUp stores the Geräteplätze of every school and
// gives device administration its own permissions (#2312).
//
//   - platform.schools.device_slots is the number of Geräteplätze the school
//     bought. NULL means moto has not set one yet: such a school keeps
//     registering devices as before, so no school stops working at the
//     deploy. Only the operator sets it; the tenant role keeps its plain
//     read grant on the table, as for the Kinderkontingent (#3567).
//   - iot:read becomes devices:read and iot:manage devices:manage in place,
//     so every role grant keeps its row. iot:update only guarded edits,
//     blocks and pings, which are device management now: its roles get
//     devices:manage, then iot:update goes. Every role that may manage
//     devices may also see them: devices:manage brings devices:read.
//     Admins hold both through admin:* anyway.
func deviceSlotsAndPermissionsUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, deviceSlotsColumnSQL); err != nil {
			return fmt.Errorf("add school device slots: %w", err)
		}
		if _, err := tx.ExecContext(ctx, devicePermissionsUpSQL); err != nil {
			return fmt.Errorf("move device permissions to devices:*: %w", err)
		}
		if _, err := tx.ExecContext(ctx, deviceSlotLockFunctionSQL); err != nil {
			return fmt.Errorf("create the Geräteplatz lock function: %w", err)
		}
		return nil
	})
}

// deviceSlotsAndPermissionsDown restores iot:*. It cannot tell which
// devices:manage role had only iot:update before, so every role holding it
// gets iot:manage and iot:update back.
func deviceSlotsAndPermissionsDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `DROP FUNCTION IF EXISTS platform.lock_school_device_slots(BIGINT);`); err != nil {
			return fmt.Errorf("drop the Geräteplatz lock function: %w", err)
		}
		if _, err := tx.ExecContext(ctx, devicePermissionsDownSQL); err != nil {
			return fmt.Errorf("move device permissions back to iot:*: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `ALTER TABLE platform.schools DROP COLUMN IF EXISTS device_slots;`); err != nil {
			return fmt.Errorf("drop school device slots: %w", err)
		}
		return nil
	})
}

const deviceSlotsColumnSQL = `
	ALTER TABLE platform.schools
		ADD COLUMN device_slots INTEGER CHECK (device_slots BETWEEN 0 AND 1000);
	COMMENT ON COLUMN platform.schools.device_slots IS
		'Geräteplätze the school bought (#2312). NULL means moto has not set a limit yet.';
`

// deviceSlotLockFunctionSQL takes the per-school Geräteplatz lock and then
// reads the school's limit (#2312). Both run inside one VOLATILE function on
// purpose: in READ COMMITTED every statement inside it reads with a fresh
// snapshot, so the read sees a limit an operator lowered and committed while
// this transaction waited for the lock. A single SELECT that took the lock
// and read the row would keep the snapshot from before the wait. The key
// 0x67657261 ("gera") is the one the operator's change takes. No row means
// the school does not exist.
const deviceSlotLockFunctionSQL = `
	CREATE FUNCTION platform.lock_school_device_slots(p_school_id BIGINT)
	RETURNS TABLE (device_slots INTEGER)
	LANGUAGE plpgsql
	VOLATILE
	SET search_path TO 'pg_catalog'
	AS $function$
	BEGIN
		PERFORM pg_catalog.pg_advisory_xact_lock(1734701665, p_school_id::integer);
		RETURN QUERY SELECT s.device_slots FROM platform.schools AS s WHERE s.id = p_school_id;
	END
	$function$;
	REVOKE ALL ON FUNCTION platform.lock_school_device_slots(BIGINT) FROM PUBLIC;
	GRANT EXECUTE ON FUNCTION platform.lock_school_device_slots(BIGINT) TO phoenix_tenant, phoenix_admin;
`

const devicePermissionsUpSQL = `
	UPDATE auth.permissions
	SET name = 'devices:read', resource = 'devices', action = 'read',
		description = 'See the school''s devices and its Geräteplätze'
	WHERE name = 'iot:read';

	UPDATE auth.permissions
	SET name = 'devices:manage', resource = 'devices', action = 'manage',
		description = 'Register, edit, block and remove the school''s devices'
	WHERE name = 'iot:manage';

	INSERT INTO auth.permissions (name, description, resource, action, is_system) VALUES
		('devices:read', 'See the school''s devices and its Geräteplätze', 'devices', 'read', TRUE),
		('devices:manage', 'Register, edit, block and remove the school''s devices', 'devices', 'manage', TRUE)
	ON CONFLICT (name) DO NOTHING;

	INSERT INTO auth.role_permissions (role_id, permission_id)
	SELECT role_permission.role_id, manage.id
	FROM auth.role_permissions AS role_permission
	JOIN auth.permissions AS updated ON updated.id = role_permission.permission_id AND updated.name = 'iot:update'
	JOIN auth.permissions AS manage ON manage.name = 'devices:manage'
	ON CONFLICT (role_id, permission_id) DO NOTHING;


	DELETE FROM auth.role_permissions
	WHERE permission_id IN (SELECT id FROM auth.permissions WHERE name = 'iot:update');

	-- Managing devices needs their page: a role that could change devices
	-- without iot:read gets devices:read too.
	INSERT INTO auth.role_permissions (role_id, permission_id)
	SELECT role_permission.role_id, readable.id
	FROM auth.role_permissions AS role_permission
	JOIN auth.permissions AS manage ON manage.id = role_permission.permission_id AND manage.name = 'devices:manage'
	JOIN auth.permissions AS readable ON readable.name = 'devices:read'
	ON CONFLICT (role_id, permission_id) DO NOTHING;
	DELETE FROM auth.permissions WHERE name = 'iot:update';
`

const devicePermissionsDownSQL = `
	UPDATE auth.permissions
	SET name = 'iot:read', resource = 'iot', action = 'read', description = 'View IoT device information'
	WHERE name = 'devices:read';

	UPDATE auth.permissions
	SET name = 'iot:manage', resource = 'iot', action = 'manage', description = 'Manage all aspects of IoT devices'
	WHERE name = 'devices:manage';

	INSERT INTO auth.permissions (name, description, resource, action, is_system) VALUES
		('iot:update', 'Update IoT device information', 'iot', 'update', TRUE)
	ON CONFLICT (name) DO NOTHING;

	INSERT INTO auth.role_permissions (role_id, permission_id)
	SELECT role_permission.role_id, updated.id
	FROM auth.role_permissions AS role_permission
	JOIN auth.permissions AS manage ON manage.id = role_permission.permission_id AND manage.name = 'iot:manage'
	JOIN auth.permissions AS updated ON updated.name = 'iot:update'
	ON CONFLICT (role_id, permission_id) DO NOTHING;

`
