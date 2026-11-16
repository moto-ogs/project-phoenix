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

	ID        int64  `bun:"id,pk,autoincrement"`
	TenantID  int64  `bun:"tenant_id,notnull"`
	AccountID int64  `bun:"account_id,notnull"`
	Type      string `bun:"type,notnull"`
	Title     string `bun:"title,notnull"`
	Body      string `bun:"body,notnull"`
	DeepLink  string `bun:"deep_link,notnull"`
	// SchoolDeepLink is the link in moto schule (#7139); NULL without one.
	SchoolDeepLink *string    `bun:"school_deep_link"`
	RelatedType    string     `bun:"related_type,notnull"`
	RelatedID      int64      `bun:"related_id,notnull"`
	StudentIDs     []int64    `bun:"student_ids,array,notnull"`
	CreatedAt      time.Time  `bun:"created_at,notnull"`
	UpdatedAt      time.Time  `bun:"updated_at,notnull"`
	ReadAt         *time.Time `bun:"read_at"`
}

// publishFeedEntriesSQL writes one publication in one statement: it updates
// the recipients' unread entry of the same object last updated in the bundle
// window whose type bundles with the publication's, and adds an entry for
// every other recipient. An updated entry takes the publication's type, so a
// reinstatement turns an unread cancellation into "findet doch statt"
// (#7151). A bundled guardian entry keeps the children of both publications
// (#7140). Its result names each recipient once, with whether its entry is new.
//
// ?0 tenant, ?1 recipients, ?2 type, ?3 title, ?4 body, ?5 deep link,
// ?6 related type, ?7 related ID, ?8 now, ?9 start of the bundle window,
// ?10 the types that bundle with ?2, ?11 deep link in moto schule (NULL
// without one), ?12 children.
const publishFeedEntriesSQL = `WITH recipient AS (
		SELECT DISTINCT account_id FROM unnest(?1::bigint[]) AS input(account_id)
	), refreshed AS (
		UPDATE platform.notification_feed_entries AS entry
		SET type = ?2, title = ?3, body = ?4, deep_link = ?5, school_deep_link = ?11, updated_at = ?8,
			student_ids = ARRAY(SELECT DISTINCT child FROM unnest(entry.student_ids || ?12::bigint[]) AS child ORDER BY child)
		FROM recipient
		WHERE entry.tenant_id = ?0 AND entry.account_id = recipient.account_id
			AND entry.type = ANY(?10::text[]) AND entry.related_type = ?6 AND entry.related_id = ?7
			AND entry.read_at IS NULL AND entry.updated_at >= ?9
		RETURNING entry.account_id
	), created AS (
		INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, school_deep_link, related_type, related_id, student_ids, created_at, updated_at)
		SELECT ?0, recipient.account_id, ?2, ?3, ?4, ?5, ?11, ?6, ?7, ?12::bigint[], ?8, ?8
		FROM recipient
		WHERE NOT EXISTS (SELECT 1 FROM refreshed WHERE refreshed.account_id = recipient.account_id)
		RETURNING account_id
	)
	SELECT account_id, TRUE AS created FROM created
	UNION
	SELECT account_id, FALSE AS created FROM refreshed
	ORDER BY account_id`

// feedReaderSQL admits the feed of an account only while it is an active
// member of the school with the role of the portal it reads in (#7148,
// #7139): a staff role in the staff portal, a school-portal role in moto
// schule (third argument true). A person who left the school keeps no view of
// its entries. A staff or school session never reads a guardian entry (#7140),
// even when its account is a guardian too. The predicate applies the
// delivery-time conditions of platform.delivery_realtime_recipients, as Web
// Push and SSE do.
const feedReaderSQL = `EXISTS (SELECT 1 FROM platform.delivery_realtime_recipients AS reader
	WHERE reader.tenant_id = ? AND reader.account_id = ? AND reader.active
		AND CASE WHEN ? THEN reader.has_school_role ELSE reader.has_staff_role END)
	AND cardinality(student_ids) = 0`

// guardianFeedReadableSQL admits the entry of a guardian only while the
// account is an active guardian member of the entry's school and still holds
// parent_portal.access for at least one of its children (#7140). It runs on
// an administrative transaction across the account's schools and applies the
// delivery-time predicates Web Push and SSE apply to guardians. A revoked
// relationship hides the entry; nothing is deleted.
const guardianFeedReadableSQL = `cardinality(entry.student_ids) > 0 AND EXISTS (
	SELECT 1 FROM platform.delivery_realtime_recipients AS reader
	WHERE reader.tenant_id = entry.tenant_id AND reader.account_id = entry.account_id
		AND reader.active AND reader.has_guardian_role
		AND reader.guardian_student_ids && entry.student_ids)`

const deleteExpiredFeedEntriesSQL = `DELETE FROM platform.notification_feed_entries
	WHERE tenant_id = ? AND updated_at < ?`

type feedWriteRow struct {
	AccountID int64 `bun:"account_id"`
	Created   bool  `bun:"created"`
}

func (s *Store) PublishFeedEntries(ctx context.Context, tenantID int64, content domain.FeedEntryContent, bundleTypes []string, accountIDs []int64, now, bundleSince time.Time) (domain.FeedWrite, error) {
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
		content.RelatedType, content.RelatedID, now, bundleSince, pgdialect.Array(bundleTypes), optionalFeedLink(content.SchoolDeepLink), pgdialect.Array(feedChildren(content.StudentIDs)),
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

// optionalFeedLink stores an empty link as NULL.
func optionalFeedLink(link string) *string {
	if link == "" {
		return nil
	}
	return &link
}

func (s *Store) ListFeedEntries(ctx context.Context, tenantID, accountID int64, view domain.FeedView, after *domain.FeedCursor, limit int) ([]domain.FeedEntry, error) {
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
		Where("type = ANY(?)", pgdialect.Array(view.Types)).
		Where(feedReaderSQL, tenantID, accountID, view.School)
	if after != nil {
		query = query.Where("(updated_at, id) < (?, ?)", after.UpdatedAt, after.ID)
	}
	if err := query.OrderExpr("updated_at DESC, id DESC").Limit(int64(limit)).Scan(ctx); err != nil {
		return nil, fmt.Errorf("delivery postgres: list feed entries: %w", err)
	}
	return feedEntries(rows), nil
}

func feedEntries(rows []feedEntryRow) []domain.FeedEntry {
	entries := make([]domain.FeedEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, domain.FeedEntry{
			ID: row.ID, TenantID: row.TenantID, AccountID: row.AccountID,
			FeedEntryContent: domain.FeedEntryContent{
				Type: row.Type, Title: row.Title, Body: row.Body, DeepLink: row.DeepLink,
				SchoolDeepLink: derefFeedLink(row.SchoolDeepLink),
				RelatedType:    row.RelatedType, RelatedID: row.RelatedID, StudentIDs: row.StudentIDs,
			},
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, ReadAt: row.ReadAt,
		})
	}
	return entries
}

// feedChildren is never nil: the column is NOT NULL.
func feedChildren(studentIDs []int64) []int64 {
	if studentIDs == nil {
		return []int64{}
	}
	return studentIDs
}

func derefFeedLink(link *string) string {
	if link == nil {
		return ""
	}
	return *link
}

func (s *Store) CountUnreadFeedEntries(ctx context.Context, tenantID, accountID int64, view domain.FeedView) (int, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	count, err := db.NewSelect().Model((*feedEntryRow)(nil)).
		Where("tenant_id = ?", tenantID).
		Where("account_id = ?", accountID).
		Where("type = ANY(?)", pgdialect.Array(view.Types)).
		Where("read_at IS NULL").
		Where(feedReaderSQL, tenantID, accountID, view.School).
		Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("delivery postgres: count unread feed entries: %w", err)
	}
	return int(count), nil
}

func (s *Store) MarkFeedEntryRead(ctx context.Context, tenantID, accountID int64, view domain.FeedView, entryID int64, now time.Time) (bool, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return false, err
	}
	var ids []int64
	err = db.NewRaw(`UPDATE platform.notification_feed_entries
		SET read_at = COALESCE(read_at, ?)
		WHERE tenant_id = ? AND account_id = ? AND id = ? AND type = ANY(?) AND `+feedReaderSQL+`
		RETURNING id`, now, tenantID, accountID, entryID, pgdialect.Array(view.Types), tenantID, accountID, view.School).Scan(ctx, &ids)
	if err != nil {
		return false, fmt.Errorf("delivery postgres: mark feed entry read: %w", err)
	}
	return len(ids) == 1, nil
}

func (s *Store) MarkAllFeedEntriesRead(ctx context.Context, tenantID, accountID int64, view domain.FeedView, now time.Time) (int, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	return affected("mark all feed entries read")(db.ExecContext(ctx, `UPDATE platform.notification_feed_entries
		SET read_at = ?
		WHERE tenant_id = ? AND account_id = ? AND read_at IS NULL AND type = ANY(?) AND `+feedReaderSQL,
		now, tenantID, accountID, pgdialect.Array(view.Types), tenantID, accountID, view.School))
}

func (s *Store) DeleteExpiredFeedEntries(ctx context.Context, tenantID int64, before time.Time) (int, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	return affected("delete expired feed entries")(db.ExecContext(ctx, deleteExpiredFeedEntriesSQL, tenantID, before))
}

func (s *Store) ListGuardianFeedEntries(ctx context.Context, accountID int64, after *domain.FeedCursor, limit int) ([]domain.FeedEntry, error) {
	if limit <= 0 {
		return nil, errors.New("delivery postgres: feed page size must be positive")
	}
	db, err := s.adminDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []feedEntryRow
	query := db.NewSelect().Model(&rows).ModelTableExpr("platform.notification_feed_entries AS entry").
		ColumnExpr("entry.*").
		Where("entry.account_id = ?", accountID).
		Where(guardianFeedReadableSQL)
	if after != nil {
		query = query.Where("(entry.updated_at, entry.id) < (?, ?)", after.UpdatedAt, after.ID)
	}
	if err := query.OrderExpr("entry.updated_at DESC, entry.id DESC").Limit(int64(limit)).Scan(ctx); err != nil {
		return nil, fmt.Errorf("delivery postgres: list guardian feed entries: %w", err)
	}
	return feedEntries(rows), nil
}

func (s *Store) CountUnreadGuardianFeedEntries(ctx context.Context, accountID int64) (int, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, err
	}
	count, err := db.NewSelect().Model((*feedEntryRow)(nil)).ModelTableExpr("platform.notification_feed_entries AS entry").
		Where("entry.account_id = ?", accountID).
		Where("entry.read_at IS NULL").
		Where(guardianFeedReadableSQL).
		Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("delivery postgres: count unread guardian feed entries: %w", err)
	}
	return int(count), nil
}

func (s *Store) MarkGuardianFeedEntryRead(ctx context.Context, accountID, entryID int64, now time.Time) (int64, bool, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return 0, false, err
	}
	var tenants []int64
	err = db.NewRaw(`UPDATE platform.notification_feed_entries AS entry
		SET read_at = COALESCE(entry.read_at, ?)
		WHERE entry.account_id = ? AND entry.id = ? AND `+guardianFeedReadableSQL+`
		RETURNING entry.tenant_id`, now, accountID, entryID).Scan(ctx, &tenants)
	if err != nil {
		return 0, false, fmt.Errorf("delivery postgres: mark guardian feed entry read: %w", err)
	}
	if len(tenants) != 1 {
		return 0, false, nil
	}
	return tenants[0], true, nil
}

func (s *Store) MarkAllGuardianFeedEntriesRead(ctx context.Context, accountID int64, now time.Time) ([]int64, error) {
	db, err := s.adminDB(ctx)
	if err != nil {
		return nil, err
	}
	var tenants []int64
	err = db.NewRaw(`WITH marked AS (
			UPDATE platform.notification_feed_entries AS entry
			SET read_at = ?
			WHERE entry.account_id = ? AND entry.read_at IS NULL AND `+guardianFeedReadableSQL+`
			RETURNING entry.tenant_id
		)
		SELECT DISTINCT tenant_id FROM marked ORDER BY tenant_id`, now, accountID).Scan(ctx, &tenants)
	if err != nil {
		return nil, fmt.Errorf("delivery postgres: mark all guardian feed entries read: %w", err)
	}
	return tenants, nil
}

// schoolAudienceSQL names the audience of a notice to the whole school
// (#7144) in one statement: the active members with a role of the OGS portal
// or of moto schule, and the active guardian members with the children they
// hold parent_portal.access for. It reads the projection the feed readers,
// Web Push and SSE check on delivery, so it names nobody who could not read
// the entry. An account that is staff and guardian at once is both.
const schoolAudienceSQL = `SELECT reader.account_id,
		(reader.has_staff_role OR reader.has_school_role) AS staff,
		CASE WHEN reader.has_guardian_role THEN reader.guardian_student_ids ELSE '{}'::bigint[] END AS student_ids
	FROM platform.delivery_realtime_recipients AS reader
	WHERE reader.tenant_id = ? AND reader.active
		AND (reader.has_staff_role OR reader.has_school_role
			OR (reader.has_guardian_role AND cardinality(reader.guardian_student_ids) > 0))
	ORDER BY reader.account_id`

type schoolAudienceRow struct {
	AccountID  int64   `bun:"account_id"`
	Staff      bool    `bun:"staff"`
	StudentIDs []int64 `bun:"student_ids,array"`
}

func (s *Store) SchoolAudience(ctx context.Context, tenantID int64) ([]domain.SchoolAudienceMember, error) {
	db, err := s.tenantDB(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var rows []schoolAudienceRow
	if err := db.NewRaw(schoolAudienceSQL, tenantID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("delivery postgres: school audience: %w", err)
	}
	members := make([]domain.SchoolAudienceMember, 0, len(rows))
	for _, row := range rows {
		members = append(members, domain.SchoolAudienceMember{AccountID: row.AccountID, Staff: row.Staff, StudentIDs: row.StudentIDs})
	}
	return members, nil
}
