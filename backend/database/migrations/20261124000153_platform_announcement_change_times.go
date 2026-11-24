package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const platformAnnouncementChangeTimesVersion = "20261124000153"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     platformAnnouncementChangeTimesVersion,
		Description: "Plattform-Ankündigungen: Anlage- und Änderungszeit statt Jahr 1 (#7904, ADR 0311)",
		DependsOn: []string{
			createPlatformSchemaVersion, // platform.announcements and its updated_at trigger
		},
	})
	Migrations.MustRegister(platformAnnouncementChangeTimesUp, platformAnnouncementChangeTimesDown)
}

// platformAnnouncementChangeTimesUpSQL repairs the platform announcements
// the operator wrote before #7904: the row type sent the zero time of Go
// instead of letting the columns default, so created_at and updated_at say
// year 1. updated_at is the edit version an edit and the publication send
// back (ADR 0311), and the zero time has no version: such an announcement
// could not be edited or published. The publication time stands in for the
// unknown creation; the table's trigger stamps updated_at on the UPDATE.
// Running it again changes nothing.
const platformAnnouncementChangeTimesUpSQL = `
UPDATE platform.announcements
	SET created_at = COALESCE(published_at, NOW())
	WHERE created_at < TIMESTAMPTZ '1970-01-01 00:00:00+00';
UPDATE platform.announcements
	SET updated_at = NOW()
	WHERE updated_at < TIMESTAMPTZ '1970-01-01 00:00:00+00';
`

func platformAnnouncementChangeTimesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, platformAnnouncementChangeTimesUpSQL); err != nil {
		return fmt.Errorf("give platform announcements a creation and change time: %w", err)
	}
	return nil
}

// platformAnnouncementChangeTimesDown keeps the repaired times: the year 1
// was no information worth restoring.
func platformAnnouncementChangeTimesDown(context.Context, *bun.DB) error {
	return nil
}
