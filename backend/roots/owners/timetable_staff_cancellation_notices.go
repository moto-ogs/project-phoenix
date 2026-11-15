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

// timetableStaffCancellationNotices binds Timetable's notice about a
// cancelled block (#7148) to Delivery's notification feed: every planned
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
	title, body, link := staffCancellationCopy(notice)
	err := n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
		Type: deliveryContract.NotificationInstanceCancelled,
		// A block is cancelled once; the moment keeps a later cancellation
		// after a reinstatement a notice of its own.
		IdempotencyKey: fmt.Sprintf("instance_cancelled:%d:%d", notice.InstanceID, n.now().UnixNano()),
		RelatedType:    "activity_instance", RelatedID: notice.InstanceID,
		Title: title, Body: body, DeepLink: link,
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

// staffCancellationWeekdays are the short German weekday names, Sunday first.
var staffCancellationWeekdays = [...]string{"So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."}

// staffCancellationCopy is the display-safe text of the notice: the block's
// name and when it was planned, never a child. The link leads to the
// person's own Dienstplan on that day.
func staffCancellationCopy(notice timetablePorts.StaffCancellationNotice) (title, body, link string) {
	name := strings.TrimSpace(notice.Title)
	when := staffCancellationWeekdays[notice.Date.Weekday()] + " " + notice.Date.Format("02.01.")
	if notice.StartTime.IsZero() {
		body = fmt.Sprintf("„%s“ am %s fällt aus.", name, when)
	} else {
		body = fmt.Sprintf("„%s“ am %s um %s Uhr fällt aus.", name, when, notice.StartTime.Format("15:04"))
	}
	if name == "" {
		body = strings.Replace(body, "„“", "Ein Termin", 1)
	}
	return "Termin abgesagt", body, "/mein-dienstplan?d=" + notice.Date.String()
}
