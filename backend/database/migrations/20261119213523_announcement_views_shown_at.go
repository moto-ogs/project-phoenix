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
// until dismissal.
func announcementViewsShownAtUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.announcement_views ADD COLUMN shown_at TIMESTAMPTZ`); err != nil {
		return fmt.Errorf("add announcement shown time: %w", err)
	}
	return nil
}

func announcementViewsShownAtDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.announcement_views DROP COLUMN shown_at`); err != nil {
		return fmt.Errorf("drop announcement shown time: %w", err)
	}
	return nil
}
