package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// traegerFeedReaderJoin admits an entry of the Träger bell (#7146) only in a
// school of the session's Träger and only while the account is an active
// member of that Träger with an active account. It runs on an administrative
// transaction across the Träger's schools; the view carries the school's
// name for the entry. A revoked membership hides the entries; nothing is
// deleted.
//
// ?0 Träger, ?1 account, ?2 the Träger types.
const traegerFeedReaderJoin = `INNER JOIN platform.delivery_traeger_feed_readers AS reader
		ON reader.organization_id = ?0 AND reader.tenant_id = entry.tenant_id AND reader.account_id = entry.account_id
	WHERE entry.account_id = ?1 AND entry.type = ANY(?2::text[])`

// listTraegerFeedEntriesSQL pages the bell newest update first; ?3 and ?4
// are the cursor, ?5 the page size.
const listTraegerFeedEntriesSQL = `SELECT entry.*, reader.school_name FROM platform.notification_feed_entries AS entry ` + traegerFeedReaderJoin + `
		AND (entry.updated_at, entry.id) < (?3, ?4)
	ORDER BY entry.updated_at DESC, entry.id DESC LIMIT ?5`

type traegerFeedEntryRow struct {
	feedEntryRow
	SchoolName string `bun:"school_name"`
}

func (s *Store) ListTraegerFeedEntries(ctx context.Context, organizationID, accountID int64, types []string, after *domain.FeedCursor, limit int) ([]domain.TraegerFeedEntry, error) {
	if limit <= 0 {
		return nil, errors.New("delivery postgres: feed page size must be positive")
	}
	db, err := s.adminDB(ctx)
	if err != nil {
		return nil, err
	}
	// A first page starts after the newest instant and the largest ID.
	afterAt, afterID := time.Unix(1<<40, 0), int64(1<<62)
	if after != nil {
		afterAt, afterID = after.UpdatedAt, after.ID
	}
	var rows []traegerFeedEntryRow
	if err := db.NewRaw(listTraegerFeedEntriesSQL, organizationID, accountID, pgdialect.Array(types), afterAt, afterID, limit).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("delivery postgres: list Träger feed entries: %w", err)
	}
	entries := make([]domain.TraegerFeedEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, domain.TraegerFeedEntry{FeedEntry: feedEntries([]feedEntryRow{row.feedEntryRow})[0], SchoolName: row.SchoolName})
	}
	return entries, nil
}

func (s *Store) CountUnreadTraegerFeedEntries(ctx context.Context, organizationID, accountID int64, types []string) (int, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, err
	}
	var count int
	if err := db.NewRaw(`SELECT count(*) FROM platform.notification_feed_entries AS entry `+traegerFeedReaderJoin+` AND entry.read_at IS NULL`,
		organizationID, accountID, pgdialect.Array(types)).Scan(ctx, &count); err != nil {
		return 0, fmt.Errorf("delivery postgres: count unread Träger feed entries: %w", err)
	}
	return count, nil
}

func (s *Store) MarkTraegerFeedEntryRead(ctx context.Context, organizationID, accountID int64, types []string, entryID int64, now time.Time) (bool, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return false, err
	}
	var ids []int64
	if err := db.NewRaw(`UPDATE platform.notification_feed_entries AS target
		SET read_at = COALESCE(target.read_at, ?3)
		WHERE target.id = ?4 AND target.id IN (SELECT entry.id FROM platform.notification_feed_entries AS entry `+traegerFeedReaderJoin+`)
		RETURNING target.id`, organizationID, accountID, pgdialect.Array(types), now, entryID).Scan(ctx, &ids); err != nil {
		return false, fmt.Errorf("delivery postgres: mark Träger feed entry read: %w", err)
	}
	return len(ids) == 1, nil
}

func (s *Store) MarkAllTraegerFeedEntriesRead(ctx context.Context, organizationID, accountID int64, types []string, now time.Time) (int, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, err
	}
	return affected("mark all Träger feed entries read")(db.ExecContext(ctx, `UPDATE platform.notification_feed_entries AS target
		SET read_at = ?3
		WHERE target.read_at IS NULL
			AND target.id IN (SELECT entry.id FROM platform.notification_feed_entries AS entry `+traegerFeedReaderJoin+`)`,
		organizationID, accountID, pgdialect.Array(types), now))
}
