package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const notificationFeedSchoolLinkVersion = "20261116080000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     notificationFeedSchoolLinkVersion,
		Description: "Benachrichtigungs-Feed in moto schule: Link im Schulportal (#7139)",
		DependsOn: []string{
			notificationFeedVersion, // the feed this adds a column to (#7148)
		},
	})
	Migrations.MustRegister(notificationFeedSchoolLinkUp, notificationFeedSchoolLinkDown)
}

// notificationFeedSchoolLinkUpSQL adds the link an entry has in moto schule
// (#7139). A Lehrkraft reads the same entries of her account as in the staff
// portal, narrowed to the types the school portal offers, and the staff
// portal's path is no route there. The producer writes both links once, like
// the text; NULL means the entry has no place in moto schule and opens the
// portal root. The bundling update rewrites it with title, body and link.
const notificationFeedSchoolLinkUpSQL = `
		ALTER TABLE platform.notification_feed_entries
			ADD COLUMN school_deep_link TEXT
				CHECK (school_deep_link ~ '^/($|[^/\\].*)' AND school_deep_link !~ '\\' AND char_length(school_deep_link) <= 500);
		COMMENT ON COLUMN platform.notification_feed_entries.school_deep_link IS
			'Link des Eintrags in moto schule (#7139); NULL: Startseite des Schulportals.';
		GRANT UPDATE (school_deep_link) ON platform.notification_feed_entries TO phoenix_tenant;
`

func notificationFeedSchoolLinkUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, notificationFeedSchoolLinkUpSQL); err != nil {
			return fmt.Errorf("add the school link of the notification feed: %w", err)
		}
		return nil
	})
}

func notificationFeedSchoolLinkDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE platform.notification_feed_entries DROP COLUMN IF EXISTS school_deep_link`); err != nil {
			return fmt.Errorf("drop the school link of the notification feed: %w", err)
		}
		return nil
	})
}
