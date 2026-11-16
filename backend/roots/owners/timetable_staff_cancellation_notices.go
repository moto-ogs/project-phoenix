package owners

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// timetableStaffCancellationNotices binds Timetable's notices about a
// cancelled block (#7148) and its reinstatement (#7151) to Delivery's
// notification feed: every planned
// person gets a feed entry, and a push follows for whoever did not switch the
// type off while the block lies within the push window Timetable decided.
type timetableStaffCancellationNotices struct {
	notifier    staffPushRouter
	preferences staffPushPreferences
	now         func() time.Time
}

// NewTimetableStaffCancellationNotices binds the notices over the root's
// notifications. Without Delivery's notifications it is nil, and Timetable
// tells nobody.
func NewTimetableStaffCancellationNotices(notifications DeliveryNotifications) timetablePorts.StaffCancellationNotices {
	if notifications.Notifier == nil || notifications.Preferences == nil {
		return nil
	}
	return timetableStaffCancellationNotices{notifier: notifications.Notifier, preferences: notifications.Preferences, now: time.Now}
}

func (n timetableStaffCancellationNotices) NotifyInstanceCancelled(ctx context.Context, notice timetablePorts.StaffCancellationNotice) error {
	title, body, link := staffCancellationCopy(notice, "Termin abgesagt", "fällt aus")
	return n.notify(ctx, deliveryContract.NotificationInstanceCancelled, notice, title, body, link)
}

// NotifyInstanceReinstated tells the planned staff that a cancellation was
// taken back (#7151). The push follows the person's switch for
// cancellations: who does not want to hear of a cancellation on the phone
// does not hear of its reinstatement there either.
func (n timetableStaffCancellationNotices) NotifyInstanceReinstated(ctx context.Context, notice timetablePorts.StaffCancellationNotice) error {
	title, body, link := staffCancellationCopy(notice, "Termin findet doch statt", "findet doch statt")
	return n.notify(ctx, deliveryContract.NotificationInstanceReinstated, notice, title, body, link)
}

func (n timetableStaffCancellationNotices) notify(ctx context.Context, notificationType string, notice timetablePorts.StaffCancellationNotice, title, body, link string) error {
	if len(notice.AccountIDs) == 0 {
		return nil
	}
	var push []int64
	if notice.Push {
		var err error
		if push, err = n.preferences.FilterNotOptedOut(ctx, deliveryContract.NotificationInstanceCancelled, notice.AccountIDs); err != nil {
			return fmt.Errorf("staff cancellation notice: filter recipients: %w", err)
		}
	}
	err := n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
		Type: notificationType,
		// A block is cancelled and reinstated again and again; the moment
		// keeps each change a notice of its own.
		IdempotencyKey: fmt.Sprintf("%s:%d:%d", notificationType, notice.InstanceID, n.now().UnixNano()),
		RelatedType:    "activity_instance", RelatedID: notice.InstanceID,
		Title: title, Body: body, DeepLink: link, SchoolDeepLink: staffCancellationSchoolLink,
		Audience: deliveryCompose.NotificationAudience{
			TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: notice.AccountIDs,
		},
		Feed: &deliveryContract.NotificationFeedDelivery{PushAccountIDs: push},
	})
	if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("staff cancellation notice: %w", err)
	}
	return nil
}

// staffCancellationSchoolLink leads a Lehrkraft in moto schule to her
// Aufsichten (#7139), the blocks she is planned for. The page shows today;
// the text of the notice names the day of a later block.
const staffCancellationSchoolLink = "/school/aufsichten"

// staffCancellationWeekdays are the short German weekday names, Sunday first.
var staffCancellationWeekdays = [...]string{"So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."}

// staffCancellationCopy is the display-safe text of the notice: the block's
// name, when it was planned and what happens to it, never a child. The link
// leads to the person's own Dienstplan on that day.
func staffCancellationCopy(notice timetablePorts.StaffCancellationNotice, title, outcome string) (string, string, string) {
	name := strings.TrimSpace(notice.Title)
	when := staffCancellationWeekdays[notice.Date.Weekday()] + " " + notice.Date.Format("02.01.")
	var body string
	if notice.StartTime.IsZero() {
		body = fmt.Sprintf("„%s“ am %s %s.", name, when, outcome)
	} else {
		body = fmt.Sprintf("„%s“ am %s um %s Uhr %s.", name, when, notice.StartTime.Format("15:04"), outcome)
	}
	if name == "" {
		body = strings.Replace(body, "„“", "Ein Termin", 1)
	}
	return title, body, "/mein-dienstplan?d=" + notice.Date.String()
}
