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
		if !within && (event.Feed == nil || event.Feed.HoldOutsideWindow) {
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
	content, recipients := feedEntryOf(*event)
	write, err := r.store.PublishFeedEntries(ctx, event.Audience.TenantID, content, feedBundleTypes(def), recipients, now, now.Add(-domain.FeedBundleWindow))
	if err != nil {
		return false, fmt.Errorf("write notification feed: %w", err)
	}
	event.feedChanged = append(slices.Clone(write.Created), write.Updated...)
	narrowToPush(event, write, pushAllowed)
	return len(event.feedChanged) > 0, nil
}

// feedEntryOf is the entry an event writes and the accounts it reaches: the
// staff accounts, or the guardian accounts with the children (#7140).
func feedEntryOf(event Event) (domain.FeedEntryContent, []int64) {
	content := domain.FeedEntryContent{
		Type: event.Type, Title: event.Title, Body: event.Body, DeepLink: feedDeepLink(event),
		SchoolDeepLink: feedSchoolDeepLink(event),
		RelatedType:    event.RelatedType, RelatedID: event.RelatedID,
	}
	if event.Feed.Title != "" {
		// A producer's own text, such as what the person cancelling wrote to
		// the families, may be longer than an entry holds.
		content.Title = clipFeedText(event.Feed.Title, feedTitleMaxRunes)
		content.Body = clipFeedText(event.Feed.Body, feedBodyMaxRunes)
	}
	if event.Audience.Scope != ScopeGuardian {
		return content, event.Audience.StaffAccountIDs
	}
	content.StudentIDs = slices.Clone(event.Audience.StudentIDs)
	return content, guardianAccountIDs(event.Audience)
}

// narrowToPush leaves in the audience only the accounts with a new entry the
// producer lets a push reach, and marks the event feed-only without them.
func narrowToPush(event *Event, write domain.FeedWrite, pushAllowed bool) {
	var push []int64
	if pushAllowed {
		push = feedPushRecipients(write.Created, event.Feed.PushAccountIDs)
	}
	if event.Audience.Scope == ScopeGuardian {
		event.Audience.GuardianAccountID, event.Audience.GuardianAccountIDs = 0, push
	} else {
		event.Audience.StaffAccountIDs = push
	}
	event.feedOnly = len(push) == 0
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

// feedType checks the shape a feed event needs: a staff audience with a
// staff type, or a guardian audience with a parent type about named children
// (#7140), an app-relative deep link and the object it is about.
func feedType(event Event) (TypeDefinition, error) {
	def, known := GetType(event.Type)
	if err := validateFeedAudience(event, def, known); err != nil {
		return TypeDefinition{}, err
	}
	if event.DeepLink == "" && event.Feed.DeepLink == "" {
		return TypeDefinition{}, errors.New("notification feed requires a deep link")
	}
	if !appRelative(event.Feed.DeepLink) {
		return TypeDefinition{}, errors.New("feed deep link must be an app-relative path")
	}
	if event.RelatedType == "" || event.RelatedID <= 0 {
		return TypeDefinition{}, errors.New("notification feed requires the object it is about")
	}
	if event.Feed.Title == "" && event.Feed.Body != "" {
		return TypeDefinition{}, errors.New("notification feed text needs a title")
	}
	return def, nil
}

func validateFeedAudience(event Event, def TypeDefinition, known bool) error {
	switch event.Audience.Scope {
	case ScopeStaff:
		if !known || !def.Feed || def.Portal != PortalStaff {
			return fmt.Errorf("%w: %s", ErrUnknownNotificationType, event.Type)
		}
	case ScopeGuardian:
		if !known || !def.Feed || def.Portal != PortalParent {
			return fmt.Errorf("%w: %s", ErrUnknownNotificationType, event.Type)
		}
		// A guardian reads an entry only through the children it is about;
		// without them nobody could ever read it.
		if len(event.Audience.StudentIDs) == 0 {
			return errors.New("guardian notification feed requires the children the entry is about")
		}
	default:
		return fmt.Errorf("notification feed requires the staff or guardian scope, got %q", event.Audience.Scope)
	}
	return nil
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

// requireFeedDelivery holds a type and its delivery path together (#7137):
// an event of a feed type needs its feed recipients, and an event of any
// other type must not ask for the feed. It keeps a producer from pushing a
// feed type past the feed, and a message type out of the bell.
func requireFeedDelivery(event Event) error {
	def, known := GetType(event.Type)
	writesFeed := known && def.Feed
	switch {
	case writesFeed && event.Feed == nil:
		return fmt.Errorf("notification type %s writes the feed and needs its feed recipients", event.Type)
	case !writesFeed && event.Feed != nil:
		return fmt.Errorf("notification type %s does not write the feed", event.Type)
	}
	return nil
}

// appRelative reports whether an optional link stays inside the app.
func appRelative(link string) bool {
	return link == "" || (strings.HasPrefix(link, "/") && !strings.HasPrefix(link, "//") && !strings.Contains(link, `\`))
}

// feedDeepLink is the link of the feed entry: the feed's own where the push
// opens the app without one.
func feedDeepLink(event Event) string {
	if event.Feed.DeepLink != "" {
		return event.Feed.DeepLink
	}
	return event.DeepLink
}

// feedPushRecipients keeps the accounts that got a new entry and may get a
// push; an updated entry pushes no second time.
func feedPushRecipients(created, allowed []int64) []int64 {
	var push []int64
	for _, accountID := range created {
		if slices.Contains(allowed, accountID) {
			push = append(push, accountID)
		}
	}
	return push
}
