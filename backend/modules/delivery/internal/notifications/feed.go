package notifications

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
)

// The feed (#7148) is Delivery's third channel next to Web Push and e-mail.
// A feed event's entry reaches every staff account of the audience; the
// producer has already left out the person who triggered the change. A push
// follows only for an entry that is new: a change that updates an unread
// entry of the same object within the bundle window moves it to the top
// without a second push. Whether a push may follow at all is the producer's
// decision per recipient (contract.NotificationFeedDelivery.PushAccountIDs):
// its relevance window (a change more than 14 days ahead reaches the feed
// only) and each person's own preference. A school that switched the type
// off gets neither feed entry nor push.

// feedSignalChannel is a channel that tells open sessions about a changed
// feed. It also runs for an event that reached the feed but no push.
type feedSignalChannel interface {
	Channel
	signalFeed(tenantID int64, accountIDs []int64) error
}

// windowAndFeed applies the delivery window and writes the feed entries of a
// feed event. The test notification is exempt from the window on purpose: an
// admin verifying the setup in the evening must get an answer, not silence
// that looks like a broken configuration. The window bounds pushes only: a
// feed entry is written at any time (#7148). It reports false when nothing
// is left to deliver.
func (r *router) windowAndFeed(ctx context.Context, event *Event) (bool, error) {
	pushAllowed := true
	if event.Type != TypeTest {
		within, err := r.withinActiveWindow(ctx, event.Audience.TenantID)
		if err != nil {
			return false, err
		}
		if !within && event.Feed == nil {
			return false, ErrOutsideActiveWindow
		}
		pushAllowed = within
	}
	if event.Feed == nil {
		return true, nil
	}
	return r.publishFeed(ctx, event, pushAllowed)
}

// publishFeed writes the event's feed entries and narrows its audience to the
// push recipients. It reports false when the school switched the type off,
// so the caller delivers nothing.
func (r *router) publishFeed(ctx context.Context, event *Event, pushAllowed bool) (bool, error) {
	if r.feedReader == nil || r.now == nil {
		return false, errors.New("notification feed is not configured")
	}
	def, err := feedType(*event)
	if err != nil {
		return false, err
	}
	if def.TenantGate != "" {
		enabled, err := r.settings.ResolveBoolForTenant(ctx, event.Audience.TenantID, def.TenantGate)
		if err != nil {
			return false, fmt.Errorf("resolving notification type gate: %w", err)
		}
		if !enabled {
			return false, nil
		}
	}
	now := r.now()
	write, err := r.store.PublishFeedEntries(ctx, event.Audience.TenantID, domain.FeedEntryContent{
		Type: event.Type, Title: event.Title, Body: event.Body, DeepLink: event.DeepLink,
		SchoolDeepLink: feedSchoolDeepLink(*event),
		RelatedType:    event.RelatedType, RelatedID: event.RelatedID,
	}, feedBundleTypes(def), event.Audience.StaffAccountIDs, now, now.Add(-domain.FeedBundleWindow))
	if err != nil {
		return false, fmt.Errorf("write notification feed: %w", err)
	}
	event.feedChanged = append(slices.Clone(write.Created), write.Updated...)
	var push []int64
	if pushAllowed {
		for _, accountID := range write.Created {
			if slices.Contains(event.Feed.PushAccountIDs, accountID) {
				push = append(push, accountID)
			}
		}
	}
	event.Audience.StaffAccountIDs = push
	event.feedOnly = len(push) == 0
	return len(event.feedChanged) > 0, nil
}

// feedSchoolDeepLink is the link an entry keeps for moto schule (#7139): the
// event's school link for a type the school portal shows, none otherwise.
func feedSchoolDeepLink(event Event) string {
	if !deliversToSchoolPortal(event) {
		return ""
	}
	return event.SchoolDeepLink
}

// feedBundleTypes are the types whose unread entry about the same object a
// publication of def updates within the bundle window: def itself, the type
// it takes back, and the types that take it back (#7151). A reinstatement
// shortly after a cancellation, while the cancellation is unread, updates
// that entry instead of adding a second one; so does a renewed cancellation.
func feedBundleTypes(def TypeDefinition) []string {
	types := []string{def.Key}
	if def.Reverses != "" {
		types = append(types, def.Reverses)
	}
	typeMu.RLock()
	defer typeMu.RUnlock()
	for key, other := range typeRegistry {
		if other.Reverses == def.Key {
			types = append(types, key)
		}
	}
	slices.Sort(types)
	return slices.Compact(types)
}

// feedType checks the shape a feed event needs: a staff audience, a known
// staff type, an app-relative deep link and the object it is about.
func feedType(event Event) (TypeDefinition, error) {
	if event.Audience.Scope != ScopeStaff {
		return TypeDefinition{}, fmt.Errorf("notification feed requires the staff scope, got %q", event.Audience.Scope)
	}
	def, known := GetType(event.Type)
	if !known || def.Portal != PortalStaff {
		return TypeDefinition{}, fmt.Errorf("%w: %s", ErrUnknownNotificationType, event.Type)
	}
	if event.DeepLink == "" {
		return TypeDefinition{}, errors.New("notification feed requires a deep link")
	}
	if event.RelatedType == "" || event.RelatedID <= 0 {
		return TypeDefinition{}, errors.New("notification feed requires the object it is about")
	}
	return def, nil
}
