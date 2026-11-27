package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/communication"
)

// Messaging adapters share the producer contract without a second wire shape.
type (
	NotificationEvent       = communication.NotificationEvent
	NotificationAudience    = communication.NotificationAudience
	NotificationSender      = communication.NotificationSender
	NotificationPreferences = communication.NotificationPreferences
)

// NotificationOptIns only narrows the producer's candidate recipients.
type NotificationOptIns interface {
	FilterOptedIn(context.Context, string, []int64) ([]int64, error)
}

// ParentDeliveryPolicy is the exact stateless policy used by parent producers.
type ParentDeliveryPolicy interface {
	DefaultLocale() string
	NormalizeLocale(string) string
	MotoLogoURL(string) string
	SchoolLogoURL(string, string) string
	ParentMessageCopy(string) (string, string)
	ParentAnnouncementCopy(string, string) (string, string)
	IsNotificationsDisabled(error) bool
	IsOutsideActiveWindow(error) bool
}

// NotificationErrors is the staff producer's narrower error-classification port.
type NotificationErrors interface {
	IsNotificationsDisabled(error) bool
	IsOutsideActiveWindow(error) bool
}

type notificationSender func(context.Context, communication.NotificationEvent) error

func (send notificationSender) Notify(ctx context.Context, event communication.NotificationEvent) error {
	return send(ctx, event)
}

// NewNotificationSender binds a public callback while preserving absent delivery.
func NewNotificationSender(send func(context.Context, communication.NotificationEvent) error) communication.NotificationSender {
	if send == nil {
		return nil
	}
	return notificationSender(send)
}

// Stored notification protocol values, independent of routing and copy policy.
const (
	TypeParentMessage           = communication.TypeParentMessage
	TypeParentAnnouncement      = communication.TypeParentAnnouncement
	TypeParentCareCancelled     = communication.TypeParentCareCancelled
	TypeStaffMessage            = communication.TypeStaffMessage
	TypeStaffSurvey             = communication.TypeStaffSurvey
	ParentAnnouncementPublished = communication.ParentAnnouncementPublished
	ParentPollPublished         = communication.ParentPollPublished
	ParentPollReminder          = communication.ParentPollReminder
	ParentAnnouncementReminder  = communication.ParentAnnouncementReminder
	ParentCareCancelled         = communication.ParentCareCancelled
	PriorityNormal              = communication.PriorityNormal
	PriorityHigh                = communication.PriorityHigh
	ScopeGuardian               = communication.ScopeGuardian
	ScopeStaff                  = communication.ScopeStaff
)

// LocaleNormalizer is the renderer's read-only language normalization port.
type LocaleNormalizer interface{ NormalizeLocale(string) string }

const TypeParentRequestDecided = communication.TypeParentRequestDecided

// notifyEachDurably sends the events in order as consecutive NotifyDurably
// calls and sums the receipts of those accepted before the first error.
func (s *service) notifyEachDurably(ctx context.Context, events []communication.NotificationEvent) (int, error) {
	receipts, err := s.series.NotifyDurably(ctx, events)
	accepted := 0
	for _, count := range receipts {
		accepted += count
	}
	return accepted, err
}

// localeGroups splits the push audience by portal language, in a fixed
// language order so that every run sends the variants in the same order.
func localeGroups(accountIDs []int64, localeByAccount map[int64]string) ([]string, map[string][]int64) {
	groups := make(map[string][]int64)
	var locales []string
	for _, accountID := range accountIDs {
		locale := localeByAccount[accountID]
		if _, ok := groups[locale]; !ok {
			locales = append(locales, locale)
		}
		groups[locale] = append(groups[locale], accountID)
	}
	slices.Sort(locales)
	return locales, groups
}
