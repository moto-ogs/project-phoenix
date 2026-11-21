package notifications

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// guardianFeed serves a guardian account its notification feed across the
// schools of the family (#7140). The parents portal has no school of its
// own, so every call opens one administrative transaction; the store keeps
// only the entries the account may still read. Whether it may is answered on
// every read, never stored: a guardian who lost parent_portal.access for the
// children of an entry no longer sees it, and sees it again once the school
// grants the access back.
type guardianFeed struct {
	db      *bun.DB
	runtime tenant.UnitOfWork
	store   deliveryPorts.GuardianFeedStore
	signal  func(tenantID int64, accountIDs []int64) error
	logger  *slog.Logger
	now     func() time.Time
}

// newGuardianFeed builds the guardian feed beside the router's feed: the
// SSE channel brings the database, the tenant unit of work and the
// broadcaster it already uses for guardians. A channel without them (a test
// router) leaves the guardian feed out.
func newGuardianFeed(channel *sseChannel, store deliveryPorts.GuardianFeedStore, logger *slog.Logger, now func() time.Time) *guardianFeed {
	if channel.db == nil || channel.tenantRuntime == nil || store == nil || now == nil {
		return nil
	}
	return &guardianFeed{db: channel.db, runtime: *channel.tenantRuntime, store: store, signal: channel.signalGuardianFeed, logger: logger, now: now}
}

// GuardianFeed serves the parents portal its notification feed across the
// schools of the family (#7140); nil when the router has none.
func (r *router) GuardianFeed() contract.GuardianNotificationFeed {
	if r.guardian == nil {
		return nil
	}
	return r.guardian
}

func (f *guardianFeed) getLogger() *slog.Logger {
	if f.logger == nil {
		return slog.Default()
	}
	return f.logger
}

func (f *guardianFeed) inAdminTx(ctx context.Context, accountID int64, fn func(context.Context) error) error {
	if accountID <= 0 {
		return errors.New("guardian notification feed: account is required")
	}
	ctx = tenant.WithUnitOfWork(ctx, f.runtime)
	return tenant.WithAdminTx(ctx, f.db, func(txCtx context.Context, _ bun.Tx) error {
		return fn(txCtx)
	})
}

func (f *guardianFeed) Page(ctx context.Context, accountID int64, cursor string, limit int) (FeedPage, error) {
	if limit <= 0 {
		limit = FeedDefaultPageSize
	}
	after, err := decodeFeedCursor(cursor)
	if err != nil {
		return FeedPage{}, err
	}
	return f.read(ctx, accountID, after, min(limit, FeedMaxPageSize))
}

// UnreadCount is the read of a page without entries.
func (f *guardianFeed) UnreadCount(ctx context.Context, accountID int64) (int, error) {
	page, err := f.read(ctx, accountID, nil, 0)
	return page.UnreadCount, err
}

// read loads the unread count and up to limit entries after the cursor in
// one administrative transaction; a limit of 0 loads the count only.
func (f *guardianFeed) read(ctx context.Context, accountID int64, after *domain.FeedCursor, limit int) (FeedPage, error) {
	var page FeedPage
	err := f.inAdminTx(ctx, accountID, func(txCtx context.Context) error {
		var err error
		if page.UnreadCount, err = f.store.CountUnreadGuardianFeedEntries(txCtx, accountID); err != nil || limit == 0 {
			return err
		}
		entries, err := f.store.ListGuardianFeedEntries(txCtx, accountID, after, limit+1)
		if err != nil {
			return err
		}
		page.Entries, page.NextCursor = feedPageEntries(entries, limit)
		return nil
	})
	if err != nil {
		return FeedPage{}, err
	}
	return page, nil
}

func (f *guardianFeed) MarkRead(ctx context.Context, accountID, entryID int64) (int, error) {
	var count int
	var tenantID int64
	err := f.inAdminTx(ctx, accountID, func(txCtx context.Context) error {
		var found bool
		var err error
		tenantID, found, err = f.store.MarkGuardianFeedEntryRead(txCtx, accountID, entryID, f.now())
		if err != nil {
			return err
		}
		if !found {
			return ErrFeedEntryNotFound
		}
		count, err = f.store.CountUnreadGuardianFeedEntries(txCtx, accountID)
		return err
	})
	if err != nil {
		return 0, err
	}
	f.announce([]int64{tenantID}, accountID)
	return count, nil
}

func (f *guardianFeed) MarkAllRead(ctx context.Context, accountID int64) (int, error) {
	var count int
	var tenantIDs []int64
	err := f.inAdminTx(ctx, accountID, func(txCtx context.Context) error {
		var err error
		if tenantIDs, err = f.store.MarkAllGuardianFeedEntriesRead(txCtx, accountID, f.now()); err != nil {
			return err
		}
		count, err = f.store.CountUnreadGuardianFeedEntries(txCtx, accountID)
		return err
	})
	if err != nil {
		return 0, err
	}
	f.announce(tenantIDs, accountID)
	return count, nil
}

// announce tells the account's open sessions of the parents portal that the
// read state changed, once per school whose entries changed: the relay
// between API processes addresses a school. A lost signal only delays the
// other devices until their next reload.
func (f *guardianFeed) announce(tenantIDs []int64, accountID int64) {
	for _, tenantID := range tenantIDs {
		if err := f.signal(tenantID, []int64{accountID}); err != nil {
			f.getLogger().Warn("guardian notification feed signal failed",
				"tenant_id", tenantID,
				"error", err.Error(),
			)
		}
	}
}

// feedPageEntries turns up to limit+1 loaded entries into a page: the extra
// one only says that a next page exists.
func feedPageEntries(entries []domain.FeedEntry, limit int) ([]FeedEntry, string) {
	cursor := ""
	if len(entries) > limit {
		last := entries[limit-1]
		cursor = encodeFeedCursor(domain.FeedCursor{UpdatedAt: last.UpdatedAt, ID: last.ID})
		entries = entries[:limit]
	}
	page := make([]FeedEntry, 0, len(entries))
	for _, entry := range entries {
		page = append(page, FeedEntry{
			ID: ident.ID(entry.ID), Type: entry.Type, Title: entry.Title, Body: entry.Body, DeepLink: entry.DeepLink,
			CreatedAt: entry.CreatedAt, UpdatedAt: entry.UpdatedAt, ReadAt: entry.ReadAt,
		})
	}
	return page, cursor
}
