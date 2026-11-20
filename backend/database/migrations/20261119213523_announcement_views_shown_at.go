package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const announcementViewsShownAtVersion = "20261119213523"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     announcementViewsShownAtVersion,
		Description: "Angezeigte Plattform-Ankündigungen von bisherigen Lesebestätigungen unterscheiden (#7555)",
		DependsOn:   []string{createPlatformSchemaVersion},
	})
	Migrations.MustRegister(announcementViewsShownAtUp, announcementViewsShownAtDown)
}

// Existing rows retain the former meaning of seen_at: before #7555, seeing
// an announcement closed it. New modal reports stamp shown_at and remain open
// until dismissal. A new dismissal without a displayed announcement leaves
// seen_at empty, which distinguishes it from every row created before #7555.
func announcementViewsShownAtUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.announcement_views ADD COLUMN shown_at TIMESTAMPTZ`); err != nil {
		return fmt.Errorf("add announcement shown time: %w", err)
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.announcement_views ALTER COLUMN seen_at DROP NOT NULL`); err != nil {
		return fmt.Errorf("allow announcement dismissal without shown time: %w", err)
	}
	return nil
}

func announcementViewsShownAtDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `UPDATE platform.announcement_views SET seen_at = COALESCE(seen_at, shown_at, CURRENT_TIMESTAMP) WHERE seen_at IS NULL`); err != nil {
		return fmt.Errorf("restore announcement seen time: %w", err)
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.announcement_views ALTER COLUMN seen_at SET NOT NULL`); err != nil {
		return fmt.Errorf("require announcement seen time: %w", err)
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.announcement_views DROP COLUMN shown_at`); err != nil {
		return fmt.Errorf("drop announcement shown time: %w", err)
	}
	return nil
}
