package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const notificationFeedSchoolOnlyVersion = "20261116190000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     notificationFeedSchoolOnlyVersion,
		Description: "Benachrichtigungs-Feed: Einträge nur für moto schule (#7144)",
		DependsOn: []string{
			notificationFeedSchoolLinkVersion,
		},
	})
	Migrations.MustRegister(notificationFeedSchoolOnlyUp, notificationFeedSchoolOnlyDown)
}

// notificationFeedSchoolOnlyUp lets an entry omit its OGS link only when it
// has a moto-schule link. Delivery uses that shape for accounts that may read
// a notification exclusively in moto schule; the OGS feed reader hides it.
const notificationFeedSchoolOnlyUpSQL = `
		ALTER TABLE platform.notification_feed_entries
			DROP CONSTRAINT notification_feed_entries_deep_link_check;
		ALTER TABLE platform.notification_feed_entries
			ADD CONSTRAINT notification_feed_entries_deep_link_check CHECK (
				(deep_link = '' AND school_deep_link IS NOT NULL)
				OR (deep_link ~ '^/[^/\\]' AND char_length(deep_link) <= 500)
			);
		COMMENT ON COLUMN platform.notification_feed_entries.deep_link IS
			'Link des Eintrags im OGS-Portal (#7148); leer nur bei Einträgen ausschließlich für moto schule (#7144).';
`

func notificationFeedSchoolOnlyUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, notificationFeedSchoolOnlyUpSQL); err != nil {
			return fmt.Errorf("allow school-only notification feed entries: %w", err)
		}
		return nil
	})
}

// notificationFeedSchoolOnlyDown removes entries the former schema cannot
// represent before restoring its requirement for an OGS deep link.
func notificationFeedSchoolOnlyDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM platform.notification_feed_entries WHERE deep_link = '';
			ALTER TABLE platform.notification_feed_entries
				DROP CONSTRAINT notification_feed_entries_deep_link_check;
			ALTER TABLE platform.notification_feed_entries
				ADD CONSTRAINT notification_feed_entries_deep_link_check CHECK (deep_link ~ '^/[^/\\]' AND char_length(deep_link) <= 500);
			COMMENT ON COLUMN platform.notification_feed_entries.deep_link IS
				'Link des Eintrags im OGS-Portal (#7148).';`); err != nil {
			return fmt.Errorf("restore required OGS links in notification feed: %w", err)
		}
		return nil
	})
}
