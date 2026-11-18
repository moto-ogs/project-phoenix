package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const notificationFeedCatererVersion = "20261118090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     notificationFeedCatererVersion,
		Description: "Benachrichtigungs-Feed: Glocke im Caterer-Portal über alle belieferten Schulen (#7147)",
		DependsOn: []string{
			notificationFeedTraegerVersion, // the last change to the feed's readers
			mealCaterersVersion,            // auth.caterer_accounts and auth.caterer_schools, the supply
		},
	})
	Migrations.MustRegister(notificationFeedCatererUp, notificationFeedCatererDown)
}

// notificationFeedCatererUpSQL gives Delivery the two reads the bell of the
// caterer portal needs (#7147), without a new table: a caterer entry is an
// entry of platform.notification_feed_entries in the school it is about, so
// RLS stays per school and the school's erasure and retention take it along.
//
//   - platform.delivery_caterer_feed_audience() names, in the tenant
//     transaction of a school, the active accounts of the caterer that
//     currently supplies the school (ADR 0077: at most one running supply).
//     It runs as the caller: the request role reads the supply of its school
//     under RLS and the caterer's account links, so the function answers only
//     for the school bound to the transaction.
//   - platform.delivery_caterer_feed_readers(account) is the running supplies
//     of the account's caterer with the school's name, for the administrative
//     unit in which the bell reads across the schools the caterer supplies.
//     It runs as the caller (the administrative role) and is a function, not
//     a view, so it pins no column type.
const notificationFeedCatererUpSQL = `
		CREATE FUNCTION platform.delivery_caterer_feed_audience()
		RETURNS TABLE (account_id BIGINT)
		LANGUAGE sql STABLE SET search_path = pg_catalog AS $body$
			SELECT link.account_id
			FROM auth.caterer_schools AS supply
			INNER JOIN auth.caterer_accounts AS link ON link.caterer_id = supply.caterer_id
			INNER JOIN auth.accounts AS account ON account.id = link.account_id AND account.active
			WHERE supply.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint
				AND supply.ended_at IS NULL
			ORDER BY link.account_id
		$body$;
		REVOKE ALL ON FUNCTION platform.delivery_caterer_feed_audience() FROM PUBLIC;
		GRANT EXECUTE ON FUNCTION platform.delivery_caterer_feed_audience() TO phoenix_tenant;

		CREATE FUNCTION platform.delivery_caterer_feed_readers(p_account_id BIGINT)
		RETURNS TABLE (tenant_id BIGINT, school_name TEXT, account_id BIGINT)
		LANGUAGE sql STABLE SET search_path = pg_catalog AS $body$
			SELECT school.id, school.name::text, link.account_id
			FROM auth.caterer_accounts AS link
			INNER JOIN auth.accounts AS account ON account.id = link.account_id AND account.active
			INNER JOIN auth.caterer_schools AS supply ON supply.caterer_id = link.caterer_id AND supply.ended_at IS NULL
			INNER JOIN platform.schools AS school ON school.id = supply.tenant_id AND school.deleted_at IS NULL
			WHERE link.account_id = p_account_id
		$body$;
		REVOKE ALL ON FUNCTION platform.delivery_caterer_feed_readers(BIGINT) FROM PUBLIC;
		GRANT EXECUTE ON FUNCTION platform.delivery_caterer_feed_readers(BIGINT) TO phoenix_admin;
		COMMENT ON FUNCTION platform.delivery_caterer_feed_readers(BIGINT) IS
			'Wer die Glocke des Caterer-Portals liest (#7147): die laufenden Belieferungen des Caterers des Kontos, mit dem Namen der Schule.';
`

func notificationFeedCatererUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, notificationFeedCatererUpSQL); err != nil {
			return fmt.Errorf("add the caterer readers of the notification feed: %w", err)
		}
		return nil
	})
}

// notificationFeedCatererDown removes the caterer entries with their readers:
// no other portal shows them.
func notificationFeedCatererDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM platform.notification_feed_entries WHERE type LIKE 'caterer\_%';
			DROP FUNCTION IF EXISTS platform.delivery_caterer_feed_readers(BIGINT);
			DROP FUNCTION IF EXISTS platform.delivery_caterer_feed_audience();`); err != nil {
			return fmt.Errorf("remove the caterer readers of the notification feed: %w", err)
		}
		return nil
	})
}
