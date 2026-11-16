package owners

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// staffNoticePublicationPreferences narrows the push of a published Hinweis
// to who switched the type on: it is off by default (#7143).
type staffNoticePublicationPreferences interface {
	FilterOptedIn(ctx context.Context, notificationType string, accountIDs []int64) ([]int64, error)
}

// timetableStaffNoticePublications binds Timetable's notice about a new
// Hinweis der Leitung (#7143) to the readers of the Tagesinformationen and
// to Delivery's notification feed: every reader gets a feed entry, and a
// push follows for whoever switched the type on while the notice starts
// within the push window Timetable decided.
type timetableStaffNoticePublications struct {
	staff       StaffPermissionHolders
	notifier    staffPushRouter
	preferences staffNoticePublicationPreferences
	now         func() time.Time
}

// NewTimetableStaffNoticePublications binds the notices over the school's
// staff and the root's notifications. Without Delivery's notifications it is
// nil, and Timetable tells nobody.
func NewTimetableStaffNoticePublications(staff StaffPermissionHolders, notifications DeliveryNotifications) timetablePorts.StaffNoticePublications {
	if staff == nil || notifications.Notifier == nil || notifications.Preferences == nil {
		return nil
	}
	return timetableStaffNoticePublications{staff: staff, notifier: notifications.Notifier, preferences: notifications.Preferences, now: time.Now}
}

// readers lists the live staff of the request's school whose active
// account reads the Tagesinformationen in the OGS portal (users:read),
// without the actor.
func (n timetableStaffNoticePublications) readers(ctx context.Context, actorAccountID int64) ([]int64, error) {
	rows, err := n.staff.ListStaffWithPermission(ctx, permissions.UsersRead)
	if err != nil {
		return nil, fmt.Errorf("staff notice publication: list readers: %w", err)
	}
	accounts := make([]int64, 0, len(rows))
	for _, row := range rows {
		if row != nil && row.AccountID > 0 && row.AccountID != actorAccountID {
			accounts = append(accounts, row.AccountID)
		}
	}
	return accounts, nil
}

func (n timetableStaffNoticePublications) NotifyStaffNoticePublished(ctx context.Context, publication timetablePorts.StaffNoticePublication) error {
	accountIDs, err := n.readers(ctx, publication.ActorAccountID)
	if err != nil || len(accountIDs) == 0 {
		return err
	}
	var push []int64
	if publication.Push {
		if push, err = n.preferences.FilterOptedIn(ctx, deliveryContract.NotificationStaffNoticePublished, accountIDs); err != nil {
			return fmt.Errorf("staff notice publication: filter recipients: %w", err)
		}
	}
	title, body, link := staffNoticePublicationCopy(publication)
	err = n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
		Type: deliveryContract.NotificationStaffNoticePublished,
		// A notice switched off and on again is published again; the moment
		// keeps that a notice of its own.
		IdempotencyKey: fmt.Sprintf("staff_notice_published:%d:%d", publication.NoticeID, n.now().UnixNano()),
		RelatedType:    "staff_notice", RelatedID: publication.NoticeID,
		Title: title, Body: body, DeepLink: link,
		Audience: deliveryCompose.NotificationAudience{
			TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: accountIDs,
		},
		Feed: &deliveryContract.NotificationFeedDelivery{PushAccountIDs: push},
	})
	if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("staff notice publication: %w", err)
	}
	return nil
}

// staffNoticePublicationCopy is the text of the notice: the Hinweis's title
// and from when it applies. Its body stays on the page the link leads to,
// which shows this Hinweis even when it does not apply today.
func staffNoticePublicationCopy(publication timetablePorts.StaffNoticePublication) (title, body, link string) {
	name := strings.TrimSpace(publication.Title)
	if name == "" {
		name = "Ohne Titel"
	}
	from := publication.ValidFrom.Format("02.01.2006")
	switch {
	case publication.ValidUntil == publication.ValidFrom:
		body = fmt.Sprintf("„%s“ gilt am %s.", name, from)
	case publication.ValidUntil.IsZero():
		body = fmt.Sprintf("„%s“ gilt ab %s.", name, from)
	default:
		body = fmt.Sprintf("„%s“ gilt vom %s bis %s.", name, from, publication.ValidUntil.Format("02.01.2006"))
	}
	return "Neuer Hinweis der Leitung", body, fmt.Sprintf("/tagesinformationen?hinweis=%d", publication.NoticeID)
}
