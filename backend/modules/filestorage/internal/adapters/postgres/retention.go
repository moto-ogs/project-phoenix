package postgres

import (
	"context"
	"fmt"
	"time"
)

// CleanupRetentionStore implements ports.CleanupRetentionStore. The direct
// DELETE on the intent tables stays revoked from the tenant role; the
// database functions of 1.15.449 delete only finished intents of the
// transaction's school and refuse a cutoff inside the window; the function
// of 1.15.465 does the same for the rows of removed files.
type CleanupRetentionStore struct{ database Database }

// databaseClock is the package's one read of the database clock: the
// functions guard their windows on it, so the cutoffs count back from it
// (1.15.606, ADR 0281, Nachtrag).
const databaseClock = `statement_timestamp()`

// NewCleanupRetentionStore wires the retention of the cleanup intents.
func NewCleanupRetentionStore(database Database) *CleanupRetentionStore {
	if database == nil {
		panic("file storage postgres: database runtime is required")
	}
	return &CleanupRetentionStore{database: database}
}

func (s *CleanupRetentionStore) DeleteFinishedFileCleanups(ctx context.Context, window time.Duration) (int, error) {
	db, tenantID, err := requireTenant(s.database, ctx)
	if err != nil {
		return 0, err
	}
	var deleted int64
	// The guards run in UTC (1.15.606): subtract the same elapsed 24-hour
	// days, not Berlin calendar days of 23 or 25 hours.
	if err := db.NewRaw(`SELECT documents.delete_finished_file_cleanups(?, `+databaseClock+` - (? * INTERVAL '1 second'))`, tenantID, window.Seconds()).Scan(ctx, &deleted); err != nil {
		return 0, fmt.Errorf("file storage postgres: delete finished file cleanups: %w", err)
	}
	return int(deleted), nil
}

func (s *CleanupRetentionStore) DeleteFinishedAttachmentCleanups(ctx context.Context, window time.Duration) (int, error) {
	db, tenantID, err := requireTenant(s.database, ctx)
	if err != nil {
		return 0, err
	}
	var deleted int64
	if err := db.NewRaw(`SELECT documents.delete_finished_announcement_attachment_cleanups(?, `+databaseClock+` - (? * INTERVAL '1 second'))`, tenantID, window.Seconds()).Scan(ctx, &deleted); err != nil {
		return 0, fmt.Errorf("file storage postgres: delete finished attachment cleanups: %w", err)
	}
	return int(deleted), nil
}

func (s *CleanupRetentionStore) DeleteRemovedFiles(ctx context.Context, window time.Duration) (int, error) {
	db, tenantID, err := requireTenant(s.database, ctx)
	if err != nil {
		return 0, err
	}
	var deleted int64
	if err := db.NewRaw(`SELECT documents.delete_removed_files(?, `+databaseClock+` - (? * INTERVAL '1 second'))`, tenantID, window.Seconds()).Scan(ctx, &deleted); err != nil {
		return 0, fmt.Errorf("file storage postgres: delete removed files: %w", err)
	}
	return int(deleted), nil
}
