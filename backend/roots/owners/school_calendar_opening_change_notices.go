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
	"github.com/moto-ogs/project-phoenix/tenant"
)

// Where the entries lead (#8178): the staff and the families open the
// calendar of their portal, the Träger-Büro the view of the school.
const (
	openingChangeStaffLink   = "/calendar"
	openingChangeParentLink  = "/parents/calendar"
	openingChangeTraegerLink = "/traeger/schulen/%d"
	openingChangeRelatedType = "opening_change"
	// A change of the Träger (#8231) is another object than a school's
	// change with the same id; the feed bundles by object.
	traegerOpeningChangeRelatedType = "traeger_opening_change"
)

// schoolCalendarOpeningChangeNotices binds School Calendar's notice about a
// changed opening time (#8178) to Delivery, on the pattern of the closing
// days (#7144): every staff account of the school in the OGS portal, every
// family with parent_portal.access for a child of the school and every
// member of the school's Träger get a feed entry, without the person who made
// the change. A push follows for staff and families who did not switch the
// type off while a day of the change lies within the push window. moto schule
// and the caterer stay out: whether the opening time reaches them is open in
// #8172.
type schoolCalendarOpeningChangeNotices struct {
	schoolCalendarClosingDayNotices
}

// NewSchoolCalendarOpeningChangeNotices binds the notices over the root's
// notifications; actor names the account of the request. Without Delivery's
// notifications it is nil, and School Calendar tells nobody.
func NewSchoolCalendarOpeningChangeNotices(notifications DeliveryNotifications, actor func(context.Context) int64) schoolcalendar.OpeningChangeNotices {
	if notifications.SchoolAudience == nil || notifications.Notifier == nil || notifications.Preferences == nil || actor == nil {
		return nil
	}
	return schoolCalendarOpeningChangeNotices{schoolCalendarClosingDayNotices{
		audience: notifications.SchoolAudience, notifier: notifications.Notifier, preferences: notifications.Preferences,
		traeger: notifications.TraegerNotices, actor: actor, now: time.Now,
	}}
}

func (n schoolCalendarOpeningChangeNotices) NotifyOpeningChangeChanged(ctx context.Context, notice schoolcalendar.OpeningChangeNotice) error {
	tenantID := tenant.FromContext(ctx)
	audience, err := n.audience.SchoolAudience(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("opening change notice: list the school's accounts: %w", err)
	}
	actor := n.actor(ctx)
	staff, err := n.preferences.FilterPermitted(ctx, deliveryContract.NotificationOpeningChangeChanged, withoutAccount(audience.StaffAccountIDs, actor))
	if err != nil {
		return fmt.Errorf("opening change notice: filter staff recipients: %w", err)
	}
	slices.Sort(staff)
	staff = slices.Compact(staff)
	title, body := openingChangeNoticeCopy(notice)
	relatedType := openingChangeRelatedTypeOf(notice)
	key := fmt.Sprintf("opening_change:%d:%d", notice.OpeningChangeID, n.now().UnixNano())
	if notice.Traeger {
		// One change of the Träger reaches several schools.
		key = fmt.Sprintf("%s:%d:%d:%d", relatedType, tenantID, notice.OpeningChangeID, n.now().UnixNano())
	}
	event := deliveryCompose.NotificationEvent{
		RelatedType: relatedType, RelatedID: notice.OpeningChangeID, Title: title, Body: body,
	}
	if len(staff) > 0 {
		staffEvent := event
		staffEvent.Type, staffEvent.IdempotencyKey, staffEvent.DeepLink = deliveryContract.NotificationOpeningChangeChanged, key+":staff", openingChangeStaffLink
		staffEvent.Audience = deliveryCompose.NotificationAudience{
			TenantID: tenantID, Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: staff,
		}
		if err := n.send(ctx, staffEvent, staff, notice.Push); err != nil {
			return err
		}
	}
	if err := n.notifyOpeningChangeTraeger(ctx, tenantID, relatedType, notice.OpeningChangeID, title, body, withoutAccount(audience.TraegerAccountIDs, actor)); err != nil {
		return err
	}
	guardians := withoutAccount(audience.GuardianAccountIDs, actor)
	if len(guardians) == 0 || len(audience.StudentIDs) == 0 {
		return nil
	}
	guardianEvent := event
	guardianEvent.Type, guardianEvent.IdempotencyKey = deliveryContract.NotificationParentOpeningChangeChanged, key+":guardian"
	guardianEvent.DeepLink = openingChangeParentLinkFor(notice)
	// The family reads the entry while it holds parent_portal.access for one
	// of the school's children; the feed checks it on every read.
	guardianEvent.Audience = deliveryCompose.NotificationAudience{
		TenantID: tenantID, Scope: deliveryCompose.NotificationAudienceScope("guardian"),
		GuardianAccountIDs: guardians, StudentIDs: audience.StudentIDs,
	}
	return n.send(ctx, guardianEvent, guardians, notice.Push)
}

// notifyOpeningChangeTraeger writes the notice into the bell of the
// Träger-Portal of the school's Träger; the bell names the school.
func (n schoolCalendarOpeningChangeNotices) notifyOpeningChangeTraeger(ctx context.Context, tenantID int64, relatedType string, openingChangeID int64, title, body string, members []int64) error {
	if n.traeger == nil || len(members) == 0 {
		return nil
	}
	err := n.traeger.NotifyTraeger(ctx, deliveryContract.TraegerFeedEvent{
		Type: deliveryContract.NotificationTraegerOpeningChangeChanged, TenantID: tenantID, AccountIDs: members,
		Title: title, Body: body, DeepLink: fmt.Sprintf(openingChangeTraegerLink, tenantID),
		RelatedType: relatedType, RelatedID: openingChangeID,
	})
	if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("opening change notice: Träger: %w", err)
	}
	return nil
}

// openingChangeNoticeCopy is the text of the notice: what changed, on which
// days, at which times, and the name the school gave the day. It names no
// person and no child.
func openingChangeNoticeCopy(notice schoolcalendar.OpeningChangeNotice) (title, body string) {
	reason := strings.TrimSpace(notice.Reason)
	named := "Die geänderte Öffnungszeit"
	if reason != "" {
		named = fmt.Sprintf("Die geänderte Öffnungszeit „%s“", reason)
	}
	switch {
	case notice.Previous == nil:
		title = "Geänderte Öffnungszeit"
		span := *notice.Current
		days := fmt.Sprintf("Am %s", closingDayDate(span.StartsOn))
		if span.StartsOn != span.EndsOn {
			days = fmt.Sprintf("Vom %s bis %s", closingDayDate(span.StartsOn), closingDayDate(span.EndsOn))
		}
		body = fmt.Sprintf("%s ist von %s bis %s Uhr geöffnet", days, span.OpensAt, span.ClosesAt)
		if reason != "" {
			body += ": " + reason
		}
		body += "."
	case notice.Current == nil:
		title = "Geänderte Öffnungszeit entfällt"
		body = fmt.Sprintf("%s %s entfällt. Es gelten wieder die normalen Öffnungszeiten.", named, openingChangeDays(*notice.Previous))
	default:
		title = "Öffnungszeit geändert"
		body = fmt.Sprintf("%s gilt jetzt %s. Bisher: %s.", named, openingChangeSpanText(*notice.Current), openingChangeSpanText(*notice.Previous))
	}
	if notice.Traeger {
		body += " Das hat der Träger eingetragen."
	}
	return title, body
}

// openingChangeRelatedTypeOf names the object of the notice: the school's
// own change or the change of its Träger.
func openingChangeRelatedTypeOf(notice schoolcalendar.OpeningChangeNotice) string {
	if notice.Traeger {
		return traegerOpeningChangeRelatedType
	}
	return openingChangeRelatedType
}

// openingChangeSpanText reads a change as "am 12.12.2030 von 08:00 bis
// 12:00 Uhr" or as "vom 12.12.2030 bis 14.12.2030 von 08:00 bis 12:00 Uhr".
func openingChangeSpanText(span schoolcalendar.OpeningChangeSpan) string {
	return fmt.Sprintf("%s von %s bis %s Uhr", openingChangeDays(span), span.OpensAt, span.ClosesAt)
}

func openingChangeDays(span schoolcalendar.OpeningChangeSpan) string {
	return closingDaySpan(schoolcalendar.ClosingDayRange{StartsOn: span.StartsOn, EndsOn: span.EndsOn})
}

// openingChangeParentLinkFor opens the parents' calendar on the first day of
// the change as it now stands, or as it stood before it was deleted.
func openingChangeParentLinkFor(notice schoolcalendar.OpeningChangeNotice) string {
	span := notice.Current
	if span == nil {
		span = notice.Previous
	}
	return fmt.Sprintf("%s?date=%s", openingChangeParentLink, span.StartsOn.String())
}
