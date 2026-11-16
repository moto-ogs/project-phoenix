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
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// Where the entries lead: the calendars that show the school's closing days
// in the OGS portal, in moto schule and in the parents portal (#7144).
const (
	closingDayStaffLink  = "/calendar"
	closingDaySchoolLink = "/school/kalender"
	closingDayParentLink = "/calendar"
)

// schoolCalendarClosingDayNotices binds School Calendar's notice about a
// changed closing day (#7144) to Delivery: every account of the school in the
// OGS portal and in moto schule, and every family with parent_portal.access
// for a child of the school, gets a feed entry, without the person who made
// the change. A push follows for whoever did not switch the type off while a
// day of the change lies within the push window School Calendar decided.
type schoolCalendarClosingDayNotices struct {
	audience    deliveryContract.SchoolAudience
	notifier    staffPushRouter
	preferences staffPushPreferences
	actor       func(context.Context) int64
	now         func() time.Time
}

// NewSchoolCalendarClosingDayNotices binds the notices over the root's
// notifications; actor names the account of the request. Without Delivery's
// notifications it is nil, and School Calendar tells nobody.
func NewSchoolCalendarClosingDayNotices(notifications DeliveryNotifications, actor func(context.Context) int64) schoolcalendar.ClosingDayNotices {
	if notifications.SchoolAudience == nil || notifications.Notifier == nil || notifications.Preferences == nil || actor == nil {
		return nil
	}
	return schoolCalendarClosingDayNotices{
		audience: notifications.SchoolAudience, notifier: notifications.Notifier, preferences: notifications.Preferences,
		actor: actor, now: time.Now,
	}
}

func (n schoolCalendarClosingDayNotices) NotifyClosingDayChanged(ctx context.Context, notice schoolcalendar.ClosingDayNotice) error {
	tenantID := tenant.FromContext(ctx)
	audience, err := n.audience.SchoolAudience(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("closing day notice: list the school's accounts: %w", err)
	}
	actor := n.actor(ctx)
	staff := withoutAccount(audience.StaffAccountIDs, actor)
	guardians := withoutAccount(audience.GuardianAccountIDs, actor)
	title, body := closingDayNoticeCopy(notice)
	key := fmt.Sprintf("school_closing_day:%d:%d", notice.ClosingDayID, n.now().UnixNano())
	event := deliveryCompose.NotificationEvent{
		RelatedType: "closing_day", RelatedID: notice.ClosingDayID, Title: title, Body: body,
	}
	if len(staff) > 0 {
		staffEvent := event
		staffEvent.Type, staffEvent.IdempotencyKey = deliveryContract.NotificationSchoolClosingDayChanged, key+":staff"
		staffEvent.DeepLink, staffEvent.SchoolDeepLink = closingDayStaffLink, closingDaySchoolLink
		staffEvent.Audience = deliveryCompose.NotificationAudience{
			TenantID: tenantID, Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: staff,
		}
		if err := n.send(ctx, staffEvent, staff, notice.Push); err != nil {
			return err
		}
	}
	if len(guardians) == 0 || len(audience.StudentIDs) == 0 {
		return nil
	}
	guardianEvent := event
	guardianEvent.Type, guardianEvent.IdempotencyKey = deliveryContract.NotificationParentSchoolClosingDayChanged, key+":guardian"
	guardianEvent.DeepLink = closingDayParentLinkFor(notice)
	// The entry is about every child of the school a family reaches it
	// through: a guardian reads it while holding parent_portal.access for
	// one of them, which the feed checks on every read.
	guardianEvent.Audience = deliveryCompose.NotificationAudience{
		TenantID: tenantID, Scope: deliveryCompose.NotificationAudienceScope("guardian"),
		GuardianAccountIDs: guardians, StudentIDs: audience.StudentIDs,
	}
	return n.send(ctx, guardianEvent, guardians, notice.Push)
}

// send writes the event's feed entries and lets a push reach the recipients
// who did not switch the type off. Both types follow the school's switch.
func (n schoolCalendarClosingDayNotices) send(ctx context.Context, event deliveryCompose.NotificationEvent, recipients []int64, push bool) error {
	var pushTo []int64
	if push {
		var err error
		if pushTo, err = n.preferences.FilterNotOptedOut(ctx, event.Type, recipients); err != nil {
			return fmt.Errorf("closing day notice: filter recipients: %w", err)
		}
	}
	event.Feed = &deliveryContract.NotificationFeedDelivery{PushAccountIDs: pushTo}
	err := n.notifier.Notify(ctx, event)
	if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("closing day notice: %w", err)
	}
	return nil
}

func withoutAccount(accountIDs []int64, excluded int64) []int64 {
	return slices.DeleteFunc(slices.Clone(accountIDs), func(id int64) bool { return id == excluded })
}

// closingDayNoticeCopy is the text of the notice: what changed, on which
// days, and the reason the school gave. It names no person and no child, and
// no name of the care: each school calls it differently.
func closingDayNoticeCopy(notice schoolcalendar.ClosingDayNotice) (title, body string) {
	reason := strings.TrimSpace(notice.Reason)
	named := "Der Schließtag"
	if reason != "" {
		named = fmt.Sprintf("Der Schließtag „%s“", reason)
	}
	switch {
	case notice.Previous == nil:
		title = "Neuer Schließtag"
		days := *notice.Current
		if days.StartsOn == days.EndsOn {
			body = fmt.Sprintf("Am %s ist ein Schließtag", closingDayDate(days.StartsOn))
		} else {
			body = fmt.Sprintf("Vom %s bis %s sind Schließtage", closingDayDate(days.StartsOn), closingDayDate(days.EndsOn))
		}
		if reason != "" {
			body += ": " + reason
		}
		body += "."
	case notice.Current == nil:
		title = "Schließtag entfällt"
		body = fmt.Sprintf("%s %s entfällt.", named, closingDaySpan(*notice.Previous))
	default:
		title = "Schließtag geändert"
		body = fmt.Sprintf("%s ist jetzt %s. Bisher: %s.", named, closingDaySpan(*notice.Current), closingDaySpan(*notice.Previous))
	}
	return title, body
}

func closingDayDate(day calendar.Date) string { return day.Format("02.01.2006") }

// closingDaySpan reads a closing day as "am 17.11.2026" or as "vom
// 17.11.2026 bis 21.11.2026".
func closingDaySpan(days schoolcalendar.ClosingDayRange) string {
	if days.StartsOn == days.EndsOn {
		return "am " + closingDayDate(days.StartsOn)
	}
	return fmt.Sprintf("vom %s bis %s", closingDayDate(days.StartsOn), closingDayDate(days.EndsOn))
}

// closingDayParentLinkFor opens the parents' calendar on the first day of the
// closing day as it now stands, or as it stood before it was cancelled.
func closingDayParentLinkFor(notice schoolcalendar.ClosingDayNotice) string {
	days := notice.Current
	if days == nil {
		days = notice.Previous
	}
	return fmt.Sprintf("%s?date=%s", closingDayParentLink, days.StartsOn.String())
}
