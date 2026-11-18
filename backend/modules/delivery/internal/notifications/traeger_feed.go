package notifications

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// The bell of the Träger-Portal (#7146): the Träger-Büro reads the entries
// of all schools of its Träger in one bell (school_feed.go).

var (
	_ contract.TraegerFeedNotifier     = (*router)(nil)
	_ contract.TraegerNotificationFeed = (*traegerFeed)(nil)
)

// NotifyTraeger writes a notice into the Träger bell of the named accounts in
// the caller's tenant transaction of the event's school (notifySchoolFeed).
func (r *router) NotifyTraeger(ctx context.Context, event contract.TraegerFeedEvent) error {
	return r.notifySchoolFeed(ctx, PortalTraeger, event)
}

// traegerFeed serves a Träger member the bell across the schools of the
// session's Träger. Each call opens one administrative transaction; the store
// keeps only the schools of that Träger and only while the account is an
// active member of it.
type traegerFeed struct {
	db      *bun.DB
	runtime tenant.UnitOfWork
	store   deliveryPorts.TraegerFeedStore
	now     func() time.Time
}

// newTraegerFeed builds the Träger bell beside the router's feed over the
// database and unit of work the SSE channel brings; a channel without them
// (a test router) leaves the Träger bell out.
func newTraegerFeed(channel *sseChannel, store deliveryPorts.TraegerFeedStore, now func() time.Time) *traegerFeed {
	if channel.db == nil || channel.tenantRuntime == nil || store == nil || now == nil {
		return nil
	}
	return &traegerFeed{db: channel.db, runtime: *channel.tenantRuntime, store: store, now: now}
}

// TraegerFeed serves the bell of the Träger-Portal (#7146); nil when the
// router has none.
func (r *router) TraegerFeed() contract.TraegerNotificationFeed {
	if r.traeger == nil {
		return nil
	}
	return r.traeger
}

func (f *traegerFeed) inAdminTx(ctx context.Context, organizationID, accountID int64, fn func(context.Context) error) error {
	if organizationID <= 0 || accountID <= 0 {
		return errors.New("traeger notification feed: Träger and account are required")
	}
	ctx = tenant.WithUnitOfWork(ctx, f.runtime)
	return tenant.WithAdminTx(ctx, f.db, func(txCtx context.Context, _ bun.Tx) error {
		return fn(txCtx)
	})
}

// session binds the bell's unit and statements to the Träger and account
// of the session.
func (f *traegerFeed) session(organizationID, accountID int64) (schoolFeedUnit, schoolFeedStatements) {
	unit := func(ctx context.Context, fn func(context.Context) error) error {
		return f.inAdminTx(ctx, organizationID, accountID, fn)
	}
	return unit, schoolFeedStatements{
		count: func(ctx context.Context, types []string) (int, error) {
			return f.store.CountUnreadTraegerFeedEntries(ctx, organizationID, accountID, types)
		},
		list: func(ctx context.Context, types []string, after *domain.FeedCursor, limit int) ([]domain.SchoolFeedEntry, error) {
			return f.store.ListTraegerFeedEntries(ctx, organizationID, accountID, types, after, limit)
		},
		markOne: func(ctx context.Context, types []string, entryID int64, now time.Time) (bool, error) {
			return f.store.MarkTraegerFeedEntryRead(ctx, organizationID, accountID, types, entryID, now)
		},
		markAll: func(ctx context.Context, types []string, now time.Time) (int, error) {
			return f.store.MarkAllTraegerFeedEntriesRead(ctx, organizationID, accountID, types, now)
		},
	}
}

func (f *traegerFeed) Page(ctx context.Context, organizationID, accountID int64, cursor string, limit int) (contract.TraegerNotificationFeedPage, error) {
	unit, statements := f.session(organizationID, accountID)
	return pageSchoolFeed(ctx, unit, statements, feedTypesOfPortal(PortalTraeger), cursor, limit)
}

// UnreadCount is the read of a page without entries.
func (f *traegerFeed) UnreadCount(ctx context.Context, organizationID, accountID int64) (int, error) {
	unit, statements := f.session(organizationID, accountID)
	page, err := readSchoolFeed(ctx, unit, statements, feedTypesOfPortal(PortalTraeger), nil, 0)
	return page.UnreadCount, err
}

func (f *traegerFeed) MarkRead(ctx context.Context, organizationID, accountID, entryID int64) (int, error) {
	unit, statements := f.session(organizationID, accountID)
	return markSchoolFeedEntryRead(ctx, unit, statements, feedTypesOfPortal(PortalTraeger), entryID, f.now())
}

func (f *traegerFeed) MarkAllRead(ctx context.Context, organizationID, accountID int64) (int, error) {
	unit, statements := f.session(organizationID, accountID)
	return markAllSchoolFeedRead(ctx, unit, statements, feedTypesOfPortal(PortalTraeger), f.now())
}
