package notifications

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// The bell of the Träger-Portal (#7146). A Träger entry is an entry of the
// notification feed in the school it is about, written in that school's
// tenant transaction like every other entry, so row-level security, the
// school's erasure and the 30-day retention apply unchanged. The Träger-Büro
// reads the entries of all schools of its Träger in one bell. The portal has
// neither push devices nor a live channel: its bell reloads the count on
// every page change and every minute.

var (
	_ contract.TraegerFeedNotifier     = (*router)(nil)
	_ contract.TraegerNotificationFeed = (*traegerFeed)(nil)
)

// NotifyTraeger writes a notice into the Träger bell of the named accounts in
// the caller's tenant transaction of the event's school. It applies the
// school's notification flag, its booked modules and the type's school switch
// as Notify does for the staff types; an event the school switched off
// writes nothing and returns ErrDisabled for the notification flag. An
// updated unread entry of the same object within the bundle window moves to
// the top instead of adding a second one.
func (r *router) NotifyTraeger(ctx context.Context, event contract.TraegerFeedEvent) error {
	if r.feedReader == nil || r.now == nil || r.store == nil {
		return errors.New("notification feed is not configured")
	}
	def, err := traegerFeedType(event)
	if err != nil {
		return err
	}
	if len(event.AccountIDs) == 0 {
		return nil
	}
	internal := Event{Type: event.Type, Title: event.Title, Body: event.Body, DeepLink: event.DeepLink,
		RelatedType: event.RelatedType, RelatedID: event.RelatedID, Audience: Audience{TenantID: event.TenantID}}
	if err := r.requireEnabledEvent(ctx, &internal); err != nil {
		return err
	}
	if def.TenantGate != "" {
		enabled, err := r.settings.ResolveBoolForTenant(ctx, event.TenantID, def.TenantGate)
		if err != nil {
			return fmt.Errorf("resolving notification type gate: %w", err)
		}
		if !enabled {
			return nil
		}
	}
	now := r.now()
	content := domain.FeedEntryContent{Type: event.Type, Title: event.Title, Body: event.Body, DeepLink: event.DeepLink,
		RelatedType: event.RelatedType, RelatedID: event.RelatedID}
	recipients := slices.Clone(event.AccountIDs)
	slices.Sort(recipients)
	recipients = slices.Compact(recipients)
	if _, err := r.store.PublishFeedEntries(ctx, event.TenantID, content, feedBundleTypes(def), recipients, now, now.Add(-domain.FeedBundleWindow)); err != nil {
		return fmt.Errorf("write Träger notification feed: %w", err)
	}
	return nil
}

// traegerFeedType checks the shape of a Träger notice: a registered Träger
// type, the school, an app-relative link and the object it is about.
func traegerFeedType(event contract.TraegerFeedEvent) (TypeDefinition, error) {
	def, known := GetType(event.Type)
	if !known || def.Portal != PortalTraeger {
		return TypeDefinition{}, fmt.Errorf("%w: %s", ErrUnknownNotificationType, event.Type)
	}
	switch {
	case event.TenantID <= 0:
		return TypeDefinition{}, errors.New("traeger notification feed requires the school")
	case event.Title == "":
		return TypeDefinition{}, errors.New("traeger notification feed requires a title")
	case event.DeepLink == "" || !appRelative(event.DeepLink):
		return TypeDefinition{}, errors.New("traeger notification feed requires an app-relative deep link")
	case event.RelatedType == "" || event.RelatedID <= 0:
		return TypeDefinition{}, errors.New("traeger notification feed requires the object it is about")
	}
	for _, accountID := range event.AccountIDs {
		if accountID <= 0 {
			return TypeDefinition{}, errors.New("traeger notification feed requires positive account ids")
		}
	}
	return def, nil
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

// traegerFeedTypes are the types the Träger bell shows.
func traegerFeedTypes() []string {
	defs := typesOfPortal(PortalTraeger)
	types := make([]string, 0, len(defs))
	for _, def := range defs {
		types = append(types, def.Key)
	}
	return types
}

// typesOfPortal lists the feed types registered for a portal that offers
// no preferences.
func typesOfPortal(portal string) []TypeDefinition {
	typeMu.RLock()
	defer typeMu.RUnlock()
	var defs []TypeDefinition
	for _, def := range typeRegistry {
		if def.Portal == portal && def.Feed {
			defs = append(defs, def)
		}
	}
	slices.SortFunc(defs, func(a, b TypeDefinition) int {
		if a.Key < b.Key {
			return -1
		}
		if a.Key > b.Key {
			return 1
		}
		return 0
	})
	return defs
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

func (f *traegerFeed) Page(ctx context.Context, organizationID, accountID int64, cursor string, limit int) (contract.TraegerNotificationFeedPage, error) {
	if limit <= 0 {
		limit = FeedDefaultPageSize
	}
	limit = min(limit, FeedMaxPageSize)
	after, err := decodeFeedCursor(cursor)
	if err != nil {
		return contract.TraegerNotificationFeedPage{}, err
	}
	types := traegerFeedTypes()
	var page contract.TraegerNotificationFeedPage
	err = f.inAdminTx(ctx, organizationID, accountID, func(txCtx context.Context) error {
		var err error
		if page.UnreadCount, err = f.store.CountUnreadTraegerFeedEntries(txCtx, organizationID, accountID, types); err != nil {
			return err
		}
		entries, err := f.store.ListTraegerFeedEntries(txCtx, organizationID, accountID, types, after, limit+1)
		if err != nil {
			return err
		}
		page.Entries, page.NextCursor = traegerFeedPageEntries(entries, limit)
		return nil
	})
	if err != nil {
		return contract.TraegerNotificationFeedPage{}, err
	}
	return page, nil
}

func (f *traegerFeed) UnreadCount(ctx context.Context, organizationID, accountID int64) (int, error) {
	var count int
	err := f.inAdminTx(ctx, organizationID, accountID, func(txCtx context.Context) error {
		var err error
		count, err = f.store.CountUnreadTraegerFeedEntries(txCtx, organizationID, accountID, traegerFeedTypes())
		return err
	})
	return count, err
}

func (f *traegerFeed) MarkRead(ctx context.Context, organizationID, accountID, entryID int64) (int, error) {
	types := traegerFeedTypes()
	var count int
	err := f.inAdminTx(ctx, organizationID, accountID, func(txCtx context.Context) error {
		found, err := f.store.MarkTraegerFeedEntryRead(txCtx, organizationID, accountID, types, entryID, f.now())
		if err != nil {
			return err
		}
		if !found {
			return ErrFeedEntryNotFound
		}
		count, err = f.store.CountUnreadTraegerFeedEntries(txCtx, organizationID, accountID, types)
		return err
	})
	return count, err
}

func (f *traegerFeed) MarkAllRead(ctx context.Context, organizationID, accountID int64) (int, error) {
	types := traegerFeedTypes()
	var count int
	err := f.inAdminTx(ctx, organizationID, accountID, func(txCtx context.Context) error {
		if _, err := f.store.MarkAllTraegerFeedEntriesRead(txCtx, organizationID, accountID, types, f.now()); err != nil {
			return err
		}
		var err error
		count, err = f.store.CountUnreadTraegerFeedEntries(txCtx, organizationID, accountID, types)
		return err
	})
	return count, err
}

// traegerFeedPageEntries turns up to limit+1 loaded entries into a page: the
// extra one only says that a next page exists.
func traegerFeedPageEntries(entries []domain.TraegerFeedEntry, limit int) ([]contract.TraegerNotificationFeedEntry, string) {
	cursor := ""
	if len(entries) > limit {
		last := entries[limit-1]
		cursor = encodeFeedCursor(domain.FeedCursor{UpdatedAt: last.UpdatedAt, ID: last.ID})
		entries = entries[:limit]
	}
	page := make([]contract.TraegerNotificationFeedEntry, 0, len(entries))
	for _, entry := range entries {
		page = append(page, contract.TraegerNotificationFeedEntry{
			NotificationFeedEntry: FeedEntry{
				ID: entry.ID, Type: entry.Type, Title: entry.Title, Body: entry.Body, DeepLink: entry.DeepLink,
				CreatedAt: entry.CreatedAt, UpdatedAt: entry.UpdatedAt, ReadAt: entry.ReadAt,
			},
			SchoolID: entry.TenantID, SchoolName: entry.SchoolName,
		})
	}
	return page, cursor
}
