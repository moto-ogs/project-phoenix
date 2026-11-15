package notifications

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
)

// The feed (#7148) is Delivery's third channel next to Web Push and e-mail.
// A feed event's entry reaches every staff account of the audience, or every
// guardian account of a guardian audience together with the children it is
// about (#7140); the
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
	// signalGuardianFeed tells the open sessions of the parents portal.
	signalGuardianFeed(tenantID int64, accountIDs []int64) error
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
	content := domain.FeedEntryContent{
		Type: event.Type, Title: event.Title, Body: event.Body, DeepLink: event.DeepLink,
		RelatedType: event.RelatedType, RelatedID: event.RelatedID,
	}
	if event.Feed.Title != "" {
		// A producer's own text, such as what the person cancelling wrote to
		// the families, may be longer than an entry holds.
		content.Title = clipFeedText(event.Feed.Title, feedTitleMaxRunes)
		content.Body = clipFeedText(event.Feed.Body, feedBodyMaxRunes)
	}
	recipients := event.Audience.StaffAccountIDs
	if event.Audience.Scope == ScopeGuardian {
		recipients = guardianAccountIDs(event.Audience)
		content.StudentIDs = slices.Clone(event.Audience.StudentIDs)
	}
	write, err := r.store.PublishFeedEntries(ctx, event.Audience.TenantID, content, recipients, now, now.Add(-domain.FeedBundleWindow))
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
	if event.Audience.Scope == ScopeGuardian {
		event.Audience.GuardianAccountID, event.Audience.GuardianAccountIDs = 0, push
	} else {
		event.Audience.StaffAccountIDs = push
	}
	event.feedOnly = len(push) == 0
	return len(event.feedChanged) > 0, nil
}

// feedType checks the shape a feed event needs: a staff audience with a
// staff type, or a guardian audience with a parent type about named children
// (#7140), an app-relative deep link and the object it is about.
func feedType(event Event) (TypeDefinition, error) {
	def, known := GetType(event.Type)
	switch event.Audience.Scope {
	case ScopeStaff:
		if !known || def.Portal != PortalStaff {
			return TypeDefinition{}, fmt.Errorf("%w: %s", ErrUnknownNotificationType, event.Type)
		}
	case ScopeGuardian:
		if !known || def.Portal != PortalParent {
			return TypeDefinition{}, fmt.Errorf("%w: %s", ErrUnknownNotificationType, event.Type)
		}
		// A guardian reads an entry only through the children it is about;
		// without them nobody could ever read it.
		if len(event.Audience.StudentIDs) == 0 {
			return TypeDefinition{}, errors.New("guardian notification feed requires the children the entry is about")
		}
	default:
		return TypeDefinition{}, fmt.Errorf("notification feed requires the staff or guardian scope, got %q", event.Audience.Scope)
	}
	if event.DeepLink == "" {
		return TypeDefinition{}, errors.New("notification feed requires a deep link")
	}
	if event.RelatedType == "" || event.RelatedID <= 0 {
		return TypeDefinition{}, errors.New("notification feed requires the object it is about")
	}
	if event.Feed.Title == "" && event.Feed.Body != "" {
		return TypeDefinition{}, errors.New("notification feed text needs a title")
	}
	return def, nil
}

// The lengths platform.notification_feed_entries allows.
const (
	feedTitleMaxRunes = 200
	feedBodyMaxRunes  = 1000
)

// clipFeedText shortens text to at most limit runes, ending in "…".
func clipFeedText(text string, limit int) string {
	text = strings.TrimSpace(text)
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return strings.TrimSpace(string(runes[:limit-1])) + "…"
}
