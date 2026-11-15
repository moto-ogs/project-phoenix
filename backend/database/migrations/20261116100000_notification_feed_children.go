package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const notificationFeedChildrenVersion = "20261116100000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     notificationFeedChildrenVersion,
		Description: "Benachrichtigungs-Feed im Elternportal: betroffene Kinder je Eintrag (#7140)",
		DependsOn: []string{
			notificationFeedVersion, // adds a column to its table
		},
	})
	Migrations.MustRegister(notificationFeedChildrenUp, notificationFeedChildrenDown)
}

// notificationFeedChildrenUpSQL stores the children an entry of a guardian is
// about (#7140). A guardian reads such an entry only while the account still
// holds parent_portal.access for at least one of them: the reader checks it
// on every read, so a revoked relationship hides the entries without
// deleting them. A staff entry names no child. The parents portal reads the
// feed of an account across its schools, newest update first; the partial
// index serves that read.
const notificationFeedChildrenUpSQL = `
		ALTER TABLE platform.notification_feed_entries
			ADD COLUMN student_ids BIGINT[] NOT NULL DEFAULT '{}'
				CHECK (0 < ALL (student_ids) AND cardinality(student_ids) <= 500);
		CREATE INDEX idx_notification_feed_entries_guardian
			ON platform.notification_feed_entries (account_id, updated_at DESC, id DESC)
			WHERE cardinality(student_ids) > 0;
		COMMENT ON COLUMN platform.notification_feed_entries.student_ids IS
			'Kinder, um die es in einem Eintrag für Eltern geht (#7140); leer bei Einträgen für Personal.';
		GRANT UPDATE (student_ids) ON platform.notification_feed_entries TO phoenix_tenant;
`

func notificationFeedChildrenUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, notificationFeedChildrenUpSQL); err != nil {
			return fmt.Errorf("add the children of a notification feed entry: %w", err)
		}
		return nil
	})
}

// notificationFeedChildrenDown drops the guardian entries before the column:
// without their children nobody could tell who may still read them.
func notificationFeedChildrenDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM platform.notification_feed_entries WHERE cardinality(student_ids) > 0;
			DROP INDEX IF EXISTS platform.idx_notification_feed_entries_guardian;
			ALTER TABLE platform.notification_feed_entries DROP COLUMN IF EXISTS student_ids;`); err != nil {
			return fmt.Errorf("drop the children of a notification feed entry: %w", err)
		}
		return nil
	})
}
