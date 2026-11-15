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

// feedEntryRow maps platform.notification_feed_entries (#7148).
type feedEntryRow struct {
	bun.BaseModel `bun:"table:platform.notification_feed_entries"`

	ID          int64      `bun:"id,pk,autoincrement"`
	TenantID    int64      `bun:"tenant_id,notnull"`
	AccountID   int64      `bun:"account_id,notnull"`
	Type        string     `bun:"type,notnull"`
	Title       string     `bun:"title,notnull"`
	Body        string     `bun:"body,notnull"`
	DeepLink    string     `bun:"deep_link,notnull"`
	RelatedType string     `bun:"related_type,notnull"`
	RelatedID   int64      `bun:"related_id,notnull"`
	CreatedAt   time.Time  `bun:"created_at,notnull"`
	UpdatedAt   time.Time  `bun:"updated_at,notnull"`
	ReadAt      *time.Time `bun:"read_at"`
}

// publishFeedEntriesSQL writes one publication in one statement: it updates
// the recipients' unread entry of the same type and object last updated in
// the bundle window and adds an entry for every other recipient. Its result
// names each recipient once, with whether its entry is new.
//
// ?0 tenant, ?1 recipients, ?2 type, ?3 title, ?4 body, ?5 deep link,
// ?6 related type, ?7 related ID, ?8 now, ?9 start of the bundle window.
const publishFeedEntriesSQL = `WITH recipient AS (
		SELECT DISTINCT account_id FROM unnest(?1::bigint[]) AS input(account_id)
	), refreshed AS (
		UPDATE platform.notification_feed_entries AS entry
		SET title = ?3, body = ?4, deep_link = ?5, updated_at = ?8
		FROM recipient
		WHERE entry.tenant_id = ?0 AND entry.account_id = recipient.account_id
			AND entry.type = ?2 AND entry.related_type = ?6 AND entry.related_id = ?7
			AND entry.read_at IS NULL AND entry.updated_at >= ?9
		RETURNING entry.account_id
	), created AS (
		INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, related_type, related_id, created_at, updated_at)
		SELECT ?0, recipient.account_id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8
		FROM recipient
		WHERE NOT EXISTS (SELECT 1 FROM refreshed WHERE refreshed.account_id = recipient.account_id)
		RETURNING account_id
	)
	SELECT account_id, TRUE AS created FROM created
	UNION
	SELECT account_id, FALSE AS created FROM refreshed
	ORDER BY account_id`

// feedReaderIsStaffSQL admits the feed of an account only while it is an
// active staff member of the school (#7148): a person who left the school
// keeps no view of its entries. It applies the delivery-time predicates of
// platform.delivery_realtime_recipients, as Web Push and SSE do.
const feedReaderIsStaffSQL = `EXISTS (SELECT 1 FROM platform.delivery_realtime_recipients AS reader
	WHERE reader.tenant_id = ? AND reader.account_id = ? AND reader.active AND reader.has_staff_role)`

const deleteExpiredFeedEntriesSQL = `DELETE FROM platform.notification_feed_entries
	WHERE tenant_id = ? AND updated_at < ?`

type feedWriteRow struct {
	AccountID int64 `bun:"account_id"`
	Created   bool  `bun:"created"`
}

func (s *Store) PublishFeedEntries(ctx context.Context, tenantID int64, content domain.FeedEntryContent, accountIDs []int64, now, bundleSince time.Time) (domain.FeedWrite, error) {
	if len(accountIDs) == 0 {
		return domain.FeedWrite{}, nil
	}
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return domain.FeedWrite{}, err
	}
	var rows []feedWriteRow
	if err := db.NewRaw(publishFeedEntriesSQL,
		tenantID, pgdialect.Array(accountIDs), content.Type, content.Title, content.Body, content.DeepLink,
		content.RelatedType, content.RelatedID, now, bundleSince,
	).Scan(ctx, &rows); err != nil {
		return domain.FeedWrite{}, fmt.Errorf("delivery postgres: publish feed entries: %w", err)
	}
	var write domain.FeedWrite
	for _, row := range rows {
		if row.Created {
			write.Created = append(write.Created, row.AccountID)
		} else {
			write.Updated = append(write.Updated, row.AccountID)
		}
	}
	return write, nil
}

func (s *Store) ListFeedEntries(ctx context.Context, tenantID, accountID int64, after *domain.FeedCursor, limit int) ([]domain.FeedEntry, error) {
	if limit <= 0 {
		return nil, errors.New("delivery postgres: feed page size must be positive")
	}
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var rows []feedEntryRow
	query := db.NewSelect().Model(&rows).
		Where("tenant_id = ?", tenantID).
		Where("account_id = ?", accountID).
		Where(feedReaderIsStaffSQL, tenantID, accountID)
	if after != nil {
		query = query.Where("(updated_at, id) < (?, ?)", after.UpdatedAt, after.ID)
	}
	if err := query.OrderExpr("updated_at DESC, id DESC").Limit(int64(limit)).Scan(ctx); err != nil {
		return nil, fmt.Errorf("delivery postgres: list feed entries: %w", err)
	}
	entries := make([]domain.FeedEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, domain.FeedEntry{
			ID: row.ID, TenantID: row.TenantID, AccountID: row.AccountID,
			FeedEntryContent: domain.FeedEntryContent{
				Type: row.Type, Title: row.Title, Body: row.Body, DeepLink: row.DeepLink,
				RelatedType: row.RelatedType, RelatedID: row.RelatedID,
			},
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, ReadAt: row.ReadAt,
		})
	}
	return entries, nil
}

func (s *Store) CountUnreadFeedEntries(ctx context.Context, tenantID, accountID int64) (int, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	count, err := db.NewSelect().Model((*feedEntryRow)(nil)).
		Where("tenant_id = ?", tenantID).
		Where("account_id = ?", accountID).
		Where("read_at IS NULL").
		Where(feedReaderIsStaffSQL, tenantID, accountID).
		Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("delivery postgres: count unread feed entries: %w", err)
	}
	return int(count), nil
}

func (s *Store) MarkFeedEntryRead(ctx context.Context, tenantID, accountID, entryID int64, now time.Time) (bool, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return false, err
	}
	var ids []int64
	err = db.NewRaw(`UPDATE platform.notification_feed_entries
		SET read_at = COALESCE(read_at, ?)
		WHERE tenant_id = ? AND account_id = ? AND id = ? AND `+feedReaderIsStaffSQL+`
		RETURNING id`, now, tenantID, accountID, entryID, tenantID, accountID).Scan(ctx, &ids)
	if err != nil {
		return false, fmt.Errorf("delivery postgres: mark feed entry read: %w", err)
	}
	return len(ids) == 1, nil
}

func (s *Store) MarkAllFeedEntriesRead(ctx context.Context, tenantID, accountID int64, now time.Time) (int, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	return affected("mark all feed entries read")(db.ExecContext(ctx, `UPDATE platform.notification_feed_entries
		SET read_at = ?
		WHERE tenant_id = ? AND account_id = ? AND read_at IS NULL AND `+feedReaderIsStaffSQL, now, tenantID, accountID, tenantID, accountID))
}

func (s *Store) DeleteExpiredFeedEntries(ctx context.Context, tenantID int64, before time.Time) (int, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	return affected("delete expired feed entries")(db.ExecContext(ctx, deleteExpiredFeedEntriesSQL, tenantID, before))
}
