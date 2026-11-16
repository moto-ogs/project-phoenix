package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const notificationFeedBundleTypeVersion = "20261116020000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     notificationFeedBundleTypeVersion,
		Description: "Benachrichtigungs-Feed: Rücknahme einer Absage aktualisiert den Eintrag (#7151)",
		DependsOn: []string{
			notificationFeedVersion, // platform.notification_feed_entries and its column grants
		},
	})
	Migrations.MustRegister(notificationFeedBundleTypeUp, notificationFeedBundleTypeDown)
}

// A reinstatement (#7151) bundles into the unread cancellation entry of the
// same block and gives it its own type, so "findet doch statt" replaces
// "fällt aus" instead of standing next to it. The tenant role may therefore
// update the type of an entry as well.
func notificationFeedBundleTypeUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `GRANT UPDATE (type) ON platform.notification_feed_entries TO phoenix_tenant`); err != nil {
		return fmt.Errorf("grant the feed type update: %w", err)
	}
	return nil
}

func notificationFeedBundleTypeDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `REVOKE UPDATE (type) ON platform.notification_feed_entries FROM phoenix_tenant`); err != nil {
		return fmt.Errorf("revoke the feed type update: %w", err)
	}
	return nil
}
