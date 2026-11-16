package api

import (
	"context"
	"errors"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/devices"
	notificationsHTTP "github.com/moto-ogs/project-phoenix/modules/delivery/http/notifications"
)

// NewNotificationHTTP binds native Delivery capabilities and HTTP runtime.
// Plain nil services remain nil; typed nil services retain native dispatch.
func NewNotificationHTTP(service deliveryCompose.NotificationService, push deliveryCompose.PushSubscriptionService, preferences deliveryCompose.NotificationPreferenceService, feed deliveryContract.NotificationFeed) *notificationsHTTP.Resource {
	var notifier notificationsHTTP.Service
	if service != nil {
		notifier = notificationNotifier{source: service}
	}
	var pushPort notificationsHTTP.PushSubscriptionService
	if push != nil {
		pushPort = notificationPushSubscriptions{source: push.StaffDevices()}
	}
	var preferencePort notificationsHTTP.PreferenceService
	if preferences != nil {
		preferencePort = notificationPreferences{source: preferences.StaffPreferences()}
	}
	return notificationsHTTP.NewResource(notifier, pushPort, preferencePort, NewNotificationFeedHTTP(feed), notificationHTTPRuntime())
}

type notificationNotifier struct {
	source deliveryCompose.NotificationService
}

func (n notificationNotifier) Notify(ctx context.Context, value notificationsHTTP.Event) error {
	return n.source.Notify(ctx, deliveryCompose.NotificationEvent{
		Type: value.Type, IdempotencyKey: value.IdempotencyKey, RelatedType: value.RelatedType, RelatedID: value.RelatedID,
		Audience: deliveryCompose.NotificationAudience{TenantID: value.Audience.TenantID, Scope: deliveryCompose.NotificationAudienceScope(value.Audience.Scope), GuardianAccountID: value.Audience.GuardianAccountID, GuardianAccountIDs: value.Audience.GuardianAccountIDs, ActiveGroupID: value.Audience.ActiveGroupID, StaffAccountIDs: value.Audience.StaffAccountIDs, StudentIDs: value.Audience.StudentIDs},
		Priority: value.Priority, Title: value.Title, Body: value.Body, DeepLink: value.DeepLink, SchoolDeepLink: value.SchoolDeepLink, Data: value.Data, Portal: value.Portal,
	})
}
func (notificationNotifier) IsDisabled(err error) bool {
	return errors.Is(err, deliveryCompose.ErrNotificationsDisabled)
}

type notificationPushSubscriptions struct {
	source devices.StaffPushSubscriptions
}

func (s notificationPushSubscriptions) PublicKey() (string, error) { return s.source.PublicKey() }
func (s notificationPushSubscriptions) Subscribe(ctx context.Context, accountID int64, input notificationsHTTP.PushSubscriptionInput) error {
	return s.source.Subscribe(ctx, accountID, devices.PushSubscriptionInput(input))
}
func (s notificationPushSubscriptions) SubscribeSchool(ctx context.Context, accountID int64, input notificationsHTTP.PushSubscriptionInput) error {
	return s.source.SubscribeSchool(ctx, accountID, devices.PushSubscriptionInput(input))
}
func (s notificationPushSubscriptions) Unsubscribe(ctx context.Context, accountID int64, endpoint string) error {
	return s.source.Unsubscribe(ctx, accountID, endpoint)
}
func (s notificationPushSubscriptions) UnsubscribeSchool(ctx context.Context, accountID int64, endpoint string) error {
	return s.source.UnsubscribeSchool(ctx, accountID, endpoint)
}
func (s notificationPushSubscriptions) IsNotConfigured(err error) bool {
	return s.source.IsNotConfigured(err)
}
func (s notificationPushSubscriptions) IsInvalidSubscription(err error) bool {
	return s.source.IsInvalidSubscription(err)
}

type notificationPreferences struct {
	source devices.StaffNotificationPreferences
}

func (s notificationPreferences) GetForAccount(ctx context.Context, accountID int64, portal string) (*notificationsHTTP.PreferenceOverview, error) {
	row, err := s.source.GetForAccount(ctx, accountID, portal)
	if err != nil || row == nil {
		return nil, err
	}
	out := &notificationsHTTP.PreferenceOverview{TenantEnabled: row.TenantEnabled}
	if row.Types != nil {
		out.Types = make([]notificationsHTTP.PreferenceState, len(row.Types))
		for i, value := range row.Types {
			out.Types[i] = notificationsHTTP.PreferenceState{Key: value.Key, Label: value.Label, Description: value.Description, Group: value.Group, Enabled: value.Enabled, Available: value.Available}
		}
	}
	return out, nil
}
func (s notificationPreferences) SetForPortalAccount(ctx context.Context, accountID int64, portal, notificationType string, enabled bool) error {
	return s.source.SetForPortalAccount(ctx, accountID, portal, notificationType, enabled)
}
func (s notificationPreferences) DisableAllForPortalAccount(ctx context.Context, accountID int64, portal string) error {
	return s.source.DisableAllForPortalAccount(ctx, accountID, portal)
}
func (s notificationPreferences) EmailSubscribed(ctx context.Context, accountID int64, permissions []string, notificationType string) (bool, error) {
	return s.source.EmailSubscribed(ctx, accountID, permissions, notificationType)
}
func (s notificationPreferences) SetEmailSubscribed(ctx context.Context, accountID int64, permissions []string, notificationType string, enabled bool) error {
	return s.source.SetEmailSubscribed(ctx, accountID, permissions, notificationType, enabled)
}
func (s notificationPreferences) IsUnknownType(err error) bool { return s.source.IsUnknownType(err) }
func (s notificationPreferences) IsPermissionRequired(err error) bool {
	return s.source.IsPermissionRequired(err)
}

// NewNotificationFeedHTTP binds Delivery's notification feed (#7148) to the
// HTTP adapter; nil stays nil.
func NewNotificationFeedHTTP(feed deliveryContract.NotificationFeed) notificationsHTTP.FeedService {
	if feed == nil {
		return nil
	}
	return notificationFeed{NotificationFeed: feed}
}

// notificationFeed translates the feed page onto the HTTP adapter's types;
// the count and read-state calls reach Delivery's reader unchanged.
type notificationFeed struct {
	deliveryContract.NotificationFeed
}

func (f notificationFeed) Page(ctx context.Context, tenantID, accountID int64, portal, cursor string, limit int) (notificationsHTTP.FeedPage, error) {
	page, err := f.NotificationFeed.Page(ctx, tenantID, accountID, portal, cursor, limit)
	if err != nil {
		return notificationsHTTP.FeedPage{}, err
	}
	out := notificationsHTTP.FeedPage{NextCursor: page.NextCursor, UnreadCount: page.UnreadCount, Entries: make([]notificationsHTTP.FeedEntry, len(page.Entries))}
	for i, entry := range page.Entries {
		out.Entries[i] = notificationsHTTP.FeedEntry(entry)
	}
	return out, nil
}
func (notificationFeed) IsNotFound(err error) bool {
	return errors.Is(err, deliveryContract.ErrNotificationFeedEntryNotFound)
}
func (notificationFeed) IsInvalidCursor(err error) bool {
	return errors.Is(err, deliveryContract.ErrInvalidNotificationFeedCursor)
}
