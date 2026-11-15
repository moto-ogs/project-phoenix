package notifications

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"
)

// Feed page sizes (#7148).
const (
	FeedDefaultPageSize = 20
	FeedMaxPageSize     = 50
)

// The feed's errors and values are Delivery's public contract (#7148).
var (
	ErrFeedEntryNotFound = contract.ErrNotificationFeedEntryNotFound
	ErrInvalidFeedCursor = contract.ErrInvalidNotificationFeedCursor
)

type (
	FeedEntry = contract.NotificationFeedEntry
	FeedPage  = contract.NotificationFeedPage
	// FeedReader serves an account its own notification feed in one school
	// (#7148). Each call runs in the school's tenant transaction of the
	// request. A change of the read state is announced to every open session
	// of the account once it is written. The signal is lossy by contract
	// (ADR 0145) and can reach another session just before the commit; its
	// client reloads with a delay, and its next poll reconciles in any case.
	FeedReader = contract.NotificationFeed
)

// feedReader is the router's read side of the feed; signal tells the open
// sessions of accounts about a change.
type feedReader struct {
	store  deliveryPorts.FeedStore
	signal func(tenantID int64, accountIDs []int64) error
	logger *slog.Logger
	now    func() time.Time
}

func (f *feedReader) getLogger() *slog.Logger {
	if f.logger == nil {
		return slog.Default()
	}
	return f.logger
}

func (f *feedReader) requireFeedCaller(tenantID, accountID int64) error {
	if f == nil || f.store == nil || f.now == nil {
		return errors.New("notification feed is not configured")
	}
	if tenantID <= 0 || accountID <= 0 {
		return errors.New("notification feed: school and account are required")
	}
	return nil
}

func (f *feedReader) Page(ctx context.Context, tenantID, accountID int64, cursor string, limit int) (FeedPage, error) {
	if limit <= 0 {
		limit = FeedDefaultPageSize
	}
	after, err := decodeFeedCursor(cursor)
	if err != nil {
		return FeedPage{}, err
	}
	return f.read(ctx, tenantID, accountID, after, min(limit, FeedMaxPageSize))
}

// UnreadCount is the read of a page without entries.
func (f *feedReader) UnreadCount(ctx context.Context, tenantID, accountID int64) (int, error) {
	page, err := f.read(ctx, tenantID, accountID, nil, 0)
	return page.UnreadCount, err
}

// read loads the unread count and up to limit entries after the cursor; a
// limit of 0 loads the count only.
func (f *feedReader) read(ctx context.Context, tenantID, accountID int64, after *domain.FeedCursor, limit int) (FeedPage, error) {
	if err := f.requireFeedCaller(tenantID, accountID); err != nil {
		return FeedPage{}, err
	}
	var page FeedPage
	var err error
	if page.UnreadCount, err = f.store.CountUnreadFeedEntries(ctx, tenantID, accountID); err != nil || limit == 0 {
		return page, err
	}
	entries, err := f.store.ListFeedEntries(ctx, tenantID, accountID, after, limit+1)
	if err != nil {
		return FeedPage{}, err
	}
	page.Entries, page.NextCursor = feedPageEntries(entries, limit)
	return page, nil
}

func (f *feedReader) MarkRead(ctx context.Context, tenantID, accountID, entryID int64) (int, error) {
	if err := f.requireFeedCaller(tenantID, accountID); err != nil {
		return 0, err
	}
	found, err := f.store.MarkFeedEntryRead(ctx, tenantID, accountID, entryID, f.now())
	if err != nil {
		return 0, err
	}
	if !found {
		return 0, ErrFeedEntryNotFound
	}
	count, err := f.store.CountUnreadFeedEntries(ctx, tenantID, accountID)
	if err != nil {
		return 0, err
	}
	f.announce(tenantID, accountID)
	return count, nil
}

func (f *feedReader) MarkAllRead(ctx context.Context, tenantID, accountID int64) (int, error) {
	if err := f.requireFeedCaller(tenantID, accountID); err != nil {
		return 0, err
	}
	if _, err := f.store.MarkAllFeedEntriesRead(ctx, tenantID, accountID, f.now()); err != nil {
		return 0, err
	}
	count, err := f.store.CountUnreadFeedEntries(ctx, tenantID, accountID)
	if err != nil {
		return 0, err
	}
	f.announce(tenantID, accountID)
	return count, nil
}

// announce tells the account's sessions that the read state changed. A lost
// signal only delays the other devices until their next reload of the feed.
func (f *feedReader) announce(tenantID, accountID int64) {
	if f.signal == nil {
		return
	}
	if err := f.signal(tenantID, []int64{accountID}); err != nil {
		f.getLogger().Warn("notification feed signal failed",
			"tenant_id", tenantID,
			"error", err.Error(),
		)
	}
}

// The cursor is the last update in microseconds and the ID of the last entry
// of a page, base64url encoded.
func encodeFeedCursor(cursor domain.FeedCursor) string {
	raw := strconv.FormatInt(cursor.UpdatedAt.UnixMicro(), 10) + "." + strconv.FormatInt(cursor.ID, 10)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeFeedCursor(cursor string) (*domain.FeedCursor, error) {
	if cursor == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, ErrInvalidFeedCursor
	}
	micros, id, ok := strings.Cut(string(raw), ".")
	if !ok {
		return nil, ErrInvalidFeedCursor
	}
	at, err := strconv.ParseInt(micros, 10, 64)
	if err != nil {
		return nil, ErrInvalidFeedCursor
	}
	entryID, err := strconv.ParseInt(id, 10, 64)
	if err != nil || entryID <= 0 {
		return nil, fmt.Errorf("%w: entry", ErrInvalidFeedCursor)
	}
	return &domain.FeedCursor{UpdatedAt: time.UnixMicro(at), ID: entryID}, nil
}
