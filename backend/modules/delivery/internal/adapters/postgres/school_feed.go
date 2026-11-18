package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// The bells across schools: the Träger-Portal's (#7146) and the caterer
// portal's (#7147). Each runs on an administrative transaction across
// schools and joins every statement with its reader function, which admits
// an entry only in a school the session reaches, only for the session's
// account and only while that reach holds; the reader carries the school's
// name for the entry. A lost reach hides the entries; nothing is deleted.

// The reader joins of the two bells. Each binds ?0 to the session's reach
// (the Träger or the caterer account), ?1 to the account and ?2 to the bell's
// types.
const (
	// traegerFeedReaderJoin admits a school of the session's Träger while the
	// account is an active member of that Träger with an active account.
	traegerFeedReaderJoin = `INNER JOIN platform.delivery_traeger_feed_readers(?0) AS reader
		ON reader.tenant_id = entry.tenant_id AND reader.account_id = entry.account_id
	WHERE entry.account_id = ?1 AND entry.type = ANY(?2::text[])`
	// catererFeedReaderJoin admits a school the account's caterer currently
	// supplies while the account is active; ?0 and ?1 are both the account.
	catererFeedReaderJoin = `INNER JOIN platform.delivery_caterer_feed_readers(?0) AS reader
		ON reader.tenant_id = entry.tenant_id AND reader.account_id = entry.account_id
	WHERE entry.account_id = ?1 AND entry.type = ANY(?2::text[])`
)

// The statements of the two bells. A page is newest update first: ?3 is the
// page size, ?4 and ?5 the cursor of a next page. Marking one entry binds ?3
// to the instant and ?4 to the entry; marking all binds ?3 to the instant.
const (
	schoolFeedPageSelect    = `SELECT entry.*, reader.school_name FROM platform.notification_feed_entries AS entry `
	schoolFeedPageOrder     = ` ORDER BY entry.updated_at DESC, entry.id DESC LIMIT ?3`
	schoolFeedNextPage      = ` AND (entry.updated_at, entry.id) < (?4, ?5)`
	schoolFeedCountSelect   = `SELECT count(*) FROM platform.notification_feed_entries AS entry `
	schoolFeedUnread        = ` AND entry.read_at IS NULL`
	schoolFeedMarkOneUpdate = `UPDATE platform.notification_feed_entries AS target
		SET read_at = COALESCE(target.read_at, ?3)
		WHERE target.id = ?4 AND target.id IN (SELECT entry.id FROM platform.notification_feed_entries AS entry `
	schoolFeedMarkOneEnd    = `) RETURNING target.id`
	schoolFeedMarkAllUpdate = `UPDATE platform.notification_feed_entries AS target
		SET read_at = ?3
		WHERE target.read_at IS NULL
			AND target.id IN (SELECT entry.id FROM platform.notification_feed_entries AS entry `

	listTraegerFeedFirstPageSQL = schoolFeedPageSelect + traegerFeedReaderJoin + schoolFeedPageOrder
	listTraegerFeedNextPageSQL  = schoolFeedPageSelect + traegerFeedReaderJoin + schoolFeedNextPage + schoolFeedPageOrder
	countUnreadTraegerFeedSQL   = schoolFeedCountSelect + traegerFeedReaderJoin + schoolFeedUnread
	markTraegerFeedEntrySQL     = schoolFeedMarkOneUpdate + traegerFeedReaderJoin + schoolFeedMarkOneEnd
	markAllTraegerFeedSQL       = schoolFeedMarkAllUpdate + traegerFeedReaderJoin + `)`

	listCatererFeedFirstPageSQL = schoolFeedPageSelect + catererFeedReaderJoin + schoolFeedPageOrder
	listCatererFeedNextPageSQL  = schoolFeedPageSelect + catererFeedReaderJoin + schoolFeedNextPage + schoolFeedPageOrder
	countUnreadCatererFeedSQL   = schoolFeedCountSelect + catererFeedReaderJoin + schoolFeedUnread
	markCatererFeedEntrySQL     = schoolFeedMarkOneUpdate + catererFeedReaderJoin + schoolFeedMarkOneEnd
	markAllCatererFeedSQL       = schoolFeedMarkAllUpdate + catererFeedReaderJoin + `)`
)

type schoolFeedEntryRow struct {
	feedEntryRow
	SchoolName string `bun:"school_name"`
}

// scanSchoolFeedPage runs a page statement of a bell.
func scanSchoolFeedPage(ctx context.Context, query *bun.RawQuery, label string) ([]domain.SchoolFeedEntry, error) {
	var rows []schoolFeedEntryRow
	if err := query.Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("delivery postgres: list %s feed entries: %w", label, err)
	}
	entries := make([]domain.SchoolFeedEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, domain.SchoolFeedEntry{FeedEntry: row.entry(), SchoolName: row.SchoolName})
	}
	return entries, nil
}

func scanSchoolFeedCount(ctx context.Context, query *bun.RawQuery, label string) (int, error) {
	var count int
	if err := query.Scan(ctx, &count); err != nil {
		return 0, fmt.Errorf("delivery postgres: count unread %s feed entries: %w", label, err)
	}
	return count, nil
}

func scanSchoolFeedMarked(ctx context.Context, query *bun.RawQuery, label string) (bool, error) {
	var ids []int64
	if err := query.Scan(ctx, &ids); err != nil {
		return false, fmt.Errorf("delivery postgres: mark %s feed entry read: %w", label, err)
	}
	return len(ids) == 1, nil
}

func (s *Store) ListTraegerFeedEntries(ctx context.Context, organizationID, accountID int64, types []string, after *domain.FeedCursor, limit int) ([]domain.SchoolFeedEntry, error) {
	if limit <= 0 {
		return nil, errors.New("delivery postgres: feed page size must be positive")
	}
	db, err := s.adminDB(ctx)
	if err != nil {
		return nil, err
	}
	query := db.NewRaw(listTraegerFeedFirstPageSQL, organizationID, accountID, pgdialect.Array(types), limit)
	if after != nil {
		query = db.NewRaw(listTraegerFeedNextPageSQL, organizationID, accountID, pgdialect.Array(types), limit, after.UpdatedAt, after.ID)
	}
	return scanSchoolFeedPage(ctx, query, "Träger")
}

func (s *Store) CountUnreadTraegerFeedEntries(ctx context.Context, organizationID, accountID int64, types []string) (int, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, err
	}
	return scanSchoolFeedCount(ctx, db.NewRaw(countUnreadTraegerFeedSQL, organizationID, accountID, pgdialect.Array(types)), "Träger")
}

func (s *Store) MarkTraegerFeedEntryRead(ctx context.Context, organizationID, accountID int64, types []string, entryID int64, now time.Time) (bool, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return false, err
	}
	return scanSchoolFeedMarked(ctx, db.NewRaw(markTraegerFeedEntrySQL, organizationID, accountID, pgdialect.Array(types), now, entryID), "Träger")
}

func (s *Store) MarkAllTraegerFeedEntriesRead(ctx context.Context, organizationID, accountID int64, types []string, now time.Time) (int, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, err
	}
	return affected("mark all Träger feed entries read")(db.ExecContext(ctx, markAllTraegerFeedSQL, organizationID, accountID, pgdialect.Array(types), now))
}

func (s *Store) ListCatererFeedEntries(ctx context.Context, accountID int64, types []string, after *domain.FeedCursor, limit int) ([]domain.SchoolFeedEntry, error) {
	if limit <= 0 {
		return nil, errors.New("delivery postgres: feed page size must be positive")
	}
	db, err := s.adminDB(ctx)
	if err != nil {
		return nil, err
	}
	query := db.NewRaw(listCatererFeedFirstPageSQL, accountID, accountID, pgdialect.Array(types), limit)
	if after != nil {
		query = db.NewRaw(listCatererFeedNextPageSQL, accountID, accountID, pgdialect.Array(types), limit, after.UpdatedAt, after.ID)
	}
	return scanSchoolFeedPage(ctx, query, "caterer")
}

func (s *Store) CountUnreadCatererFeedEntries(ctx context.Context, accountID int64, types []string) (int, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, err
	}
	return scanSchoolFeedCount(ctx, db.NewRaw(countUnreadCatererFeedSQL, accountID, accountID, pgdialect.Array(types)), "caterer")
}

func (s *Store) MarkCatererFeedEntryRead(ctx context.Context, accountID int64, types []string, entryID int64, now time.Time) (bool, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return false, err
	}
	return scanSchoolFeedMarked(ctx, db.NewRaw(markCatererFeedEntrySQL, accountID, accountID, pgdialect.Array(types), now, entryID), "caterer")
}

func (s *Store) MarkAllCatererFeedEntriesRead(ctx context.Context, accountID int64, types []string, now time.Time) (int, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, err
	}
	return affected("mark all caterer feed entries read")(db.ExecContext(ctx, markAllCatererFeedSQL, accountID, accountID, pgdialect.Array(types), now))
}

// CatererFeedAudience lists, in the tenant transaction of the school, the
// active accounts of the caterer that currently supplies it (#7147).
func (s *Store) CatererFeedAudience(ctx context.Context, tenantID int64) ([]int64, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var accountIDs []int64
	if err := db.NewRaw(`SELECT caterer.account_id FROM platform.delivery_caterer_feed_audience() AS caterer`).Scan(ctx, &accountIDs); err != nil {
		return nil, fmt.Errorf("delivery postgres: caterer feed audience: %w", err)
	}
	return accountIDs, nil
}
