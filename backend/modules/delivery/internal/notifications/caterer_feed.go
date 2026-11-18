package notifications

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// The bell of the caterer portal (#7147): a caterer account reads the
// entries of all schools its caterer currently supplies in one bell
// (school_feed.go). The school ends a supply at any time (ADR 0077); its
// entries then drop out of the bell at once.

var (
	_ contract.CatererFeedNotifier     = (*router)(nil)
	_ contract.CatererNotificationFeed = (*catererFeed)(nil)
)

// CatererAudience names, in the caller's tenant transaction of the school,
// the active accounts of the caterer that currently supplies it.
func (r *router) CatererAudience(ctx context.Context, tenantID int64) ([]int64, error) {
	if r.feedReader == nil || r.store == nil {
		return nil, errors.New("notification feed is not configured")
	}
	if tenantID <= 0 {
		return nil, errors.New("caterer audience requires the school")
	}
	accountIDs, err := r.store.CatererFeedAudience(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("caterer audience: %w", err)
	}
	return accountIDs, nil
}

// NotifyCaterer writes a notice into the caterer bell of the named accounts
// in the caller's tenant transaction of the event's school
// (notifySchoolFeed).
func (r *router) NotifyCaterer(ctx context.Context, event contract.CatererFeedEvent) error {
	// The caterer and the Träger notice share their fields; a field added to
	// only one of them fails this conversion at compile time.
	return r.notifySchoolFeed(ctx, PortalCaterer, schoolFeedNotice(event))
}

// catererFeed serves a caterer account the bell across the schools its
// caterer supplies. Each call opens one administrative transaction; the store
// keeps only the schools of a running supply and only while the account is
// active.
type catererFeed struct {
	db      *bun.DB
	runtime tenant.UnitOfWork
	store   deliveryPorts.CatererFeedStore
	now     func() time.Time
}

// newCatererFeed builds the caterer bell beside the router's feed over the
// database and unit of work the SSE channel brings; a channel without them
// (a test router) leaves the caterer bell out.
func newCatererFeed(channel *sseChannel, store deliveryPorts.CatererFeedStore, now func() time.Time) *catererFeed {
	if channel.db == nil || channel.tenantRuntime == nil || store == nil || now == nil {
		return nil
	}
	return &catererFeed{db: channel.db, runtime: *channel.tenantRuntime, store: store, now: now}
}

// CatererFeed serves the bell of the caterer portal (#7147); nil when the
// router has none.
func (r *router) CatererFeed() contract.CatererNotificationFeed {
	if r.caterer == nil {
		return nil
	}
	return r.caterer
}

func (f *catererFeed) inAdminTx(ctx context.Context, accountID int64, fn func(context.Context) error) error {
	if accountID <= 0 {
		return errors.New("caterer notification feed: account is required")
	}
	ctx = tenant.WithUnitOfWork(ctx, f.runtime)
	return tenant.WithAdminTx(ctx, f.db, func(txCtx context.Context, _ bun.Tx) error {
		return fn(txCtx)
	})
}

// session binds the bell's unit and statements to the account of the
// session.
func (f *catererFeed) session(accountID int64) (schoolFeedUnit, schoolFeedStatements) {
	unit := func(ctx context.Context, fn func(context.Context) error) error {
		return f.inAdminTx(ctx, accountID, fn)
	}
	return unit, schoolFeedStatements{
		count: func(ctx context.Context, types []string) (int, error) {
			return f.store.CountUnreadCatererFeedEntries(ctx, accountID, types)
		},
		list: func(ctx context.Context, types []string, after *domain.FeedCursor, limit int) ([]domain.SchoolFeedEntry, error) {
			return f.store.ListCatererFeedEntries(ctx, accountID, types, after, limit)
		},
		markOne: func(ctx context.Context, types []string, entryID int64, now time.Time) (bool, error) {
			return f.store.MarkCatererFeedEntryRead(ctx, accountID, types, entryID, now)
		},
		markAll: func(ctx context.Context, types []string, now time.Time) (int, error) {
			return f.store.MarkAllCatererFeedEntriesRead(ctx, accountID, types, now)
		},
	}
}

func (f *catererFeed) Page(ctx context.Context, accountID int64, cursor string, limit int) (contract.SchoolNotificationFeedPage, error) {
	unit, statements := f.session(accountID)
	return pageSchoolFeed(ctx, unit, statements, feedTypesOfPortal(PortalCaterer), cursor, limit)
}

// UnreadCount is the read of a page without entries.
func (f *catererFeed) UnreadCount(ctx context.Context, accountID int64) (int, error) {
	unit, statements := f.session(accountID)
	page, err := readSchoolFeed(ctx, unit, statements, feedTypesOfPortal(PortalCaterer), nil, 0)
	return page.UnreadCount, err
}

func (f *catererFeed) MarkRead(ctx context.Context, accountID, entryID int64) (int, error) {
	unit, statements := f.session(accountID)
	return markSchoolFeedEntryRead(ctx, unit, statements, feedTypesOfPortal(PortalCaterer), entryID, f.now())
}

func (f *catererFeed) MarkAllRead(ctx context.Context, accountID int64) (int, error) {
	unit, statements := f.session(accountID)
	return markAllSchoolFeedRead(ctx, unit, statements, feedTypesOfPortal(PortalCaterer), f.now())
}
