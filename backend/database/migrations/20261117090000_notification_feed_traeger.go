package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const notificationFeedTraegerVersion = "20261117090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     notificationFeedTraegerVersion,
		Description: "Benachrichtigungs-Feed: Glocke im Träger-Portal über alle Schulen des Trägers (#7146)",
		DependsOn: []string{
			notificationFeedSchoolOnlyVersion, // the last change to platform.notification_feed_entries
			traegerPortalVersion,              // platform.organization_accounts, the Träger membership
		},
	})
	Migrations.MustRegister(notificationFeedTraegerUp, notificationFeedTraegerDown)
}

// notificationFeedTraegerUpSQL gives Delivery the two reads the bell of the
// Träger-Portal needs (#7146), without a new table: a Träger entry is an
// entry of platform.notification_feed_entries in the school it is about, so
// RLS stays per school and the school's erasure and retention take it along.
//
//   - platform.delivery_traeger_feed_audience() names, in the tenant
//     transaction of a school, the active members of the school's Träger
//     whose account is active. The request role cannot read the Träger
//     membership, so the function runs as its owner and answers only for the
//     school bound to the transaction.
//   - platform.delivery_traeger_feed_readers is the same membership per school
//     of the Träger, with the school's name, for the administrative unit in
//     which the bell reads across the schools of the session's Träger.
const notificationFeedTraegerUpSQL = `
		CREATE FUNCTION platform.delivery_traeger_feed_audience()
		RETURNS TABLE (account_id BIGINT)
		LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $body$
			SELECT member.account_id
			FROM platform.schools AS school
			INNER JOIN platform.organization_accounts AS member
				ON member.organization_id = school.organization_id AND member.status = 'active'
			INNER JOIN auth.accounts AS account ON account.id = member.account_id AND account.active
			WHERE school.id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint AND school.deleted_at IS NULL
			ORDER BY member.account_id
		$body$;
		REVOKE ALL ON FUNCTION platform.delivery_traeger_feed_audience() FROM PUBLIC;
		GRANT EXECUTE ON FUNCTION platform.delivery_traeger_feed_audience() TO phoenix_tenant;

		CREATE VIEW platform.delivery_traeger_feed_readers
		WITH (security_invoker = true, security_barrier = true) AS
		SELECT member.organization_id, school.id AS tenant_id, school.name AS school_name, member.account_id
		FROM platform.organization_accounts AS member
		INNER JOIN platform.schools AS school ON school.organization_id = member.organization_id
		INNER JOIN auth.accounts AS account ON account.id = member.account_id
		WHERE member.status = 'active' AND account.active AND school.deleted_at IS NULL;
		REVOKE ALL ON platform.delivery_traeger_feed_readers FROM PUBLIC, phoenix_tenant;
		GRANT SELECT ON platform.delivery_traeger_feed_readers TO phoenix_admin;
		COMMENT ON VIEW platform.delivery_traeger_feed_readers IS
			'Wer die Glocke des Träger-Portals liest (#7146): aktive Mitglieder des Trägers je Schule, mit dem Namen der Schule.';
`

func notificationFeedTraegerUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, notificationFeedTraegerUpSQL); err != nil {
			return fmt.Errorf("add the Träger readers of the notification feed: %w", err)
		}
		return nil
	})
}

// notificationFeedTraegerDown removes the Träger entries with their readers:
// no other portal shows them.
func notificationFeedTraegerDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM platform.notification_feed_entries WHERE type LIKE 'traeger\_%';
			DROP VIEW IF EXISTS platform.delivery_traeger_feed_readers;
			DROP FUNCTION IF EXISTS platform.delivery_traeger_feed_audience();`); err != nil {
			return fmt.Errorf("remove the Träger readers of the notification feed: %w", err)
		}
		return nil
	})
}
