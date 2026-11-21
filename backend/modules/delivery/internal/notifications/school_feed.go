package notifications

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The bells across schools: the Träger-Portal's (#7146) and the caterer
// portal's (#7147). An entry of such a bell is an entry of the notification
// feed in the school it is about, written in that school's tenant
// transaction like every other entry, so row-level security, the school's
// erasure and the 30-day retention apply unchanged. Neither portal has push
// devices or a live channel: its bell reloads the count on every page change
// and every minute.

// schoolFeedNotice is the notice to a bell across schools; the Träger and
// the caterer event share its shape.
type schoolFeedNotice = contract.TraegerFeedEvent

// notifySchoolFeed writes a notice into the bell of a portal across schools
// for the named accounts, in the caller's tenant transaction of the notice's
// school. It applies the school's notification flag, its booked modules and
// the type's school switch as Notify does for the staff types; an event the
// school switched off writes nothing and returns ErrDisabled for the
// notification flag. An updated unread entry of the same object within the
// bundle window moves to the top instead of adding a second one.
func (r *router) notifySchoolFeed(ctx context.Context, portal string, notice schoolFeedNotice) error {
	if r.feedReader == nil || r.now == nil || r.store == nil {
		return errors.New("notification feed is not configured")
	}
	def, err := schoolFeedType(portal, notice)
	if err != nil {
		return err
	}
	if len(notice.AccountIDs) == 0 {
		return nil
	}
	internal := Event{Type: notice.Type, Title: notice.Title, Body: notice.Body, DeepLink: notice.DeepLink,
		RelatedType: notice.RelatedType, RelatedID: notice.RelatedID, Audience: Audience{TenantID: notice.TenantID}}
	if err := r.requireEnabledEvent(ctx, &internal); err != nil {
		return err
	}
	if def.TenantGate != "" {
		enabled, err := r.settings.ResolveBoolForTenant(ctx, notice.TenantID, def.TenantGate)
		if err != nil {
			return fmt.Errorf("resolving notification type gate: %w", err)
		}
		if !enabled {
			return nil
		}
	}
	now := r.now()
	content := domain.FeedEntryContent{Type: notice.Type, Title: notice.Title, Body: notice.Body, DeepLink: notice.DeepLink,
		RelatedType: notice.RelatedType, RelatedID: notice.RelatedID}
	recipients := slices.Clone(notice.AccountIDs)
	slices.Sort(recipients)
	recipients = slices.Compact(recipients)
	if _, err := r.store.PublishFeedEntries(ctx, notice.TenantID, content, feedBundleTypes(def), recipients, now, now.Add(-domain.FeedBundleWindow)); err != nil {
		return fmt.Errorf("write %s notification feed: %w", portal, err)
	}
	return nil
}

// schoolFeedType checks the shape of a notice to a bell across schools: a
// type registered for the portal, the school, an app-relative link and the
// object it is about.
func schoolFeedType(portal string, notice schoolFeedNotice) (TypeDefinition, error) {
	def, known := GetType(notice.Type)
	if !known || def.Portal != portal {
		return TypeDefinition{}, fmt.Errorf("%w: %s", ErrUnknownNotificationType, notice.Type)
	}
	switch {
	case notice.TenantID <= 0:
		return TypeDefinition{}, fmt.Errorf("%s notification feed requires the school", portal)
	case notice.Title == "":
		return TypeDefinition{}, fmt.Errorf("%s notification feed requires a title", portal)
	case notice.DeepLink == "" || !appRelative(notice.DeepLink):
		return TypeDefinition{}, fmt.Errorf("%s notification feed requires an app-relative deep link", portal)
	case notice.RelatedType == "" || notice.RelatedID <= 0:
		return TypeDefinition{}, fmt.Errorf("%s notification feed requires the object it is about", portal)
	}
	for _, accountID := range notice.AccountIDs {
		if accountID <= 0 {
			return TypeDefinition{}, fmt.Errorf("%s notification feed requires positive account ids", portal)
		}
	}
	return def, nil
}

// feedTypesOfPortal are the types the bell of a portal without preferences
// shows.
func feedTypesOfPortal(portal string) []string {
	defs := typesOfPortal(portal)
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
	slices.SortFunc(defs, func(a, b TypeDefinition) int { return strings.Compare(a.Key, b.Key) })
	return defs
}

// schoolFeedStatements are the statements of one session's bell across
// schools, already bound to the session's reach and account. Each keeps only
// the entries of the given types the session may read.
type schoolFeedStatements struct {
	count   func(ctx context.Context, types []string) (int, error)
	list    func(ctx context.Context, types []string, after *domain.FeedCursor, limit int) ([]domain.SchoolFeedEntry, error)
	markOne func(ctx context.Context, types []string, entryID int64, now time.Time) (bool, error)
	markAll func(ctx context.Context, types []string, now time.Time) (int, error)
}

// schoolFeedUnit runs fn in the one administrative unit of a bell's call.
type schoolFeedUnit func(ctx context.Context, fn func(context.Context) error) error

// pageSchoolFeed reads one page of a bell: the default page size for none,
// at most the largest page.
func pageSchoolFeed(ctx context.Context, unit schoolFeedUnit, statements schoolFeedStatements, types []string, cursor string, limit int) (contract.TraegerNotificationFeedPage, error) {
	if limit <= 0 {
		limit = FeedDefaultPageSize
	}
	after, err := decodeFeedCursor(cursor)
	if err != nil {
		return contract.TraegerNotificationFeedPage{}, err
	}
	return readSchoolFeed(ctx, unit, statements, types, after, min(limit, FeedMaxPageSize))
}

// readSchoolFeed loads the unread count and up to limit entries after the
// cursor in one administrative unit; a limit of 0 loads the count only.
func readSchoolFeed(ctx context.Context, unit schoolFeedUnit, statements schoolFeedStatements, types []string, after *domain.FeedCursor, limit int) (contract.TraegerNotificationFeedPage, error) {
	var page contract.TraegerNotificationFeedPage
	err := unit(ctx, func(txCtx context.Context) error {
		var err error
		if page.UnreadCount, err = statements.count(txCtx, types); err != nil || limit == 0 {
			return err
		}
		entries, err := statements.list(txCtx, types, after, limit+1)
		if err != nil {
			return err
		}
		page.Entries, page.NextCursor = schoolFeedPageEntries(entries, limit)
		return nil
	})
	if err != nil {
		return contract.TraegerNotificationFeedPage{}, err
	}
	return page, nil
}

// markSchoolFeedEntryRead marks one entry of a bell read and answers the new
// unread count; an entry the session cannot read is not found.
func markSchoolFeedEntryRead(ctx context.Context, unit schoolFeedUnit, statements schoolFeedStatements, types []string, entryID int64, now time.Time) (int, error) {
	var count int
	err := unit(ctx, func(txCtx context.Context) error {
		found, err := statements.markOne(txCtx, types, entryID, now)
		if err != nil {
			return err
		}
		if !found {
			return ErrFeedEntryNotFound
		}
		count, err = statements.count(txCtx, types)
		return err
	})
	return count, err
}

// markAllSchoolFeedRead marks every entry of a bell read and answers the new
// unread count.
func markAllSchoolFeedRead(ctx context.Context, unit schoolFeedUnit, statements schoolFeedStatements, types []string, now time.Time) (int, error) {
	var count int
	err := unit(ctx, func(txCtx context.Context) error {
		if _, err := statements.markAll(txCtx, types, now); err != nil {
			return err
		}
		var err error
		count, err = statements.count(txCtx, types)
		return err
	})
	return count, err
}

// schoolFeedPageEntries turns up to limit+1 loaded entries into a page: the
// extra one only says that a next page exists.
func schoolFeedPageEntries(entries []domain.SchoolFeedEntry, limit int) ([]contract.TraegerNotificationFeedEntry, string) {
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
				ID: ident.ID(entry.ID), Type: entry.Type, Title: entry.Title, Body: entry.Body, DeepLink: entry.DeepLink,
				CreatedAt: entry.CreatedAt, UpdatedAt: entry.UpdatedAt, ReadAt: entry.ReadAt,
			},
			SchoolID: entry.TenantID, SchoolName: entry.SchoolName,
		})
	}
	return page, cursor
}
