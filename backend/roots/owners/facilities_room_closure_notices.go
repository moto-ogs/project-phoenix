package owners

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	facilitiesModule "github.com/moto-ogs/project-phoenix/modules/facilities"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// roomClosureRelatedType is the object the entries of a closure bundle on.
const roomClosureRelatedType = "room_closure"

// roomClosureStaffAccounts maps staff records to their login accounts.
type roomClosureStaffAccounts interface {
	ListAccountIDsByStaffIDs(ctx context.Context, staffIDs []int64) (map[int64]int64, error)
}

// roomClosurePreferences drops the explicit declines of the push.
type roomClosurePreferences interface {
	FilterNotOptedOut(ctx context.Context, notificationType string, accountIDs []int64) ([]int64, error)
}

// facilitiesRoomClosureNotices binds Facilities' notice about a closed room
// (#8234) to Delivery: Timetable names the staff planned on a block in the
// room within the closure's days, People Directory their accounts, and each
// of them gets a feed entry in the OGS portal, without the
// person who closed the room. The push follows while the closure begins
// within the push window, unless the person switched it off. Nobody else
// hears about it: the staff without a block there, the families (they see
// the room change of the offering once the school moves it) and the Träger.
type facilitiesRoomClosureNotices struct {
	staff       timetable.RoomBlockStaffQuery
	accounts    roomClosureStaffAccounts
	notifier    staffPushRouter
	preferences roomClosurePreferences
	actor       func(context.Context) int64
}

// NewFacilitiesRoomClosureNotices binds the notices over the root's
// notifications; actor names the account of the request. Without Delivery's
// notifications it is nil, and Facilities tells nobody.
func NewFacilitiesRoomClosureNotices(db transactionruntime.Database, notifications DeliveryNotifications, accounts roomClosureStaffAccounts, actor func(context.Context) int64) (facilitiesModule.ClosureNotices, error) {
	if notifications.Notifier == nil || notifications.Preferences == nil || accounts == nil || actor == nil {
		return nil, nil
	}
	staff, err := timetableCompose.NewRoomBlockStaffQueries(db.Pool(), observeTimetableActivities)
	if err != nil {
		return nil, err
	}
	return facilitiesRoomClosureNotices{
		staff: staff, accounts: accounts, notifier: notifications.Notifier, preferences: notifications.Preferences, actor: actor,
	}, nil
}

func (n facilitiesRoomClosureNotices) NotifyRoomClosed(ctx context.Context, notice facilitiesModule.RoomClosureNotice) error {
	recipients, err := n.recipients(ctx, notice)
	if err != nil || len(recipients) == 0 {
		return err
	}
	var push []int64
	if notice.Push {
		if push, err = n.preferences.FilterNotOptedOut(ctx, deliveryContract.NotificationRoomClosed, recipients); err != nil {
			return fmt.Errorf("room closure notice: filter recipients: %w", err)
		}
	}
	title, body := roomClosureNoticeCopy(notice)
	err = n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
		Type:           deliveryContract.NotificationRoomClosed,
		IdempotencyKey: fmt.Sprintf("room_closed:%d:staff", notice.ClosureID),
		RelatedType:    roomClosureRelatedType, RelatedID: notice.ClosureID,
		Title: title, Body: body,
		DeepLink: "/mein-dienstplan?d=" + notice.StartsOn.String(),
		Audience: deliveryCompose.NotificationAudience{
			TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: recipients,
		},
		Feed: &deliveryContract.NotificationFeedDelivery{PushAccountIDs: push},
	})
	if err == nil || errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	return fmt.Errorf("room closure notice: %w", err)
}

// recipients are the accounts of the staff planned in the room within the
// closure, without the account of the request; one read each.
func (n facilitiesRoomClosureNotices) recipients(ctx context.Context, notice facilitiesModule.RoomClosureNotice) ([]int64, error) {
	staffIDs, err := n.staff.RoomBlockStaffIDs(ctx, notice.RoomID, notice.StartsOn, notice.EndsOn)
	if err != nil {
		return nil, fmt.Errorf("room closure notice: planned staff: %w", err)
	}
	if len(staffIDs) == 0 {
		return nil, nil
	}
	accountOf, err := n.accounts.ListAccountIDsByStaffIDs(ctx, staffIDs)
	if err != nil {
		return nil, fmt.Errorf("room closure notice: staff accounts: %w", err)
	}
	actor := n.actor(ctx)
	recipients := make([]int64, 0, len(staffIDs))
	for _, staffID := range staffIDs {
		if accountID, ok := accountOf[staffID]; ok && accountID > 0 && accountID != actor {
			recipients = append(recipients, accountID)
		}
	}
	slices.Sort(recipients)
	return slices.Compact(recipients), nil
}

// roomClosureNoticeCopy is the text of the notice: which room, on which
// days, the reason the school gave, and that the own block stays there until
// the school moves it. It names no person and no child.
func roomClosureNoticeCopy(notice facilitiesModule.RoomClosureNotice) (title, body string) {
	room := "Ein Raum"
	if name := strings.TrimSpace(notice.RoomName); name != "" {
		room = fmt.Sprintf("Der Raum „%s“", name)
	}
	days := "am " + closingDayDate(notice.StartsOn)
	if notice.StartsOn != notice.EndsOn {
		days = fmt.Sprintf("vom %s bis %s", closingDayDate(notice.StartsOn), closingDayDate(notice.EndsOn))
	}
	body = fmt.Sprintf("%s ist %s gesperrt", room, days)
	if reason := strings.TrimSpace(notice.Reason); reason != "" {
		body += ": " + reason
	}
	return "Raum gesperrt", body + ". Du hast in dieser Zeit dort einen Termin. Er bleibt in diesem Raum, bis die Leitung ihn verlegt."
}

// NoticeRoomClosures adds the notice of a new closure to closures (#8234);
// without Delivery's notifications they stay as they are.
func NoticeRoomClosures(db transactionruntime.Database, closures facilitiesModule.Closures, notifications DeliveryNotifications, accounts roomClosureStaffAccounts, actor func(context.Context) int64, now func() time.Time) (facilitiesModule.Closures, error) {
	notices, err := NewFacilitiesRoomClosureNotices(db, notifications, accounts, actor)
	if err != nil || notices == nil {
		return closures, err
	}
	return facilitiesCompose.NewNoticedClosures(closures, notices, now), nil
}
