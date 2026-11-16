package owners

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// timetableRoomChangeNotices binds Timetable's notice about a block that
// moved to another room (#7141) to Delivery's notification feed: the staff
// of its staffing and the guardians of its booked children who hold
// parent_portal.access for one of them get a feed entry. A move for today or
// tomorrow pushes unless the person switched it off; a later move within 14
// days pushes only for whoever switched that on; beyond, the feed only.
// Without the guardian contacts only the staff hear about it.
type timetableRoomChangeNotices struct {
	notifier    staffPushRouter
	preferences roomChangePreferences
	guardians   peopledirectory.GuardianPortalContacts
	now         func() time.Time
}

// roomChangePreferences are both consent filters: the default-on type drops
// explicit declines, the later type keeps explicit consents.
type roomChangePreferences interface {
	FilterNotOptedOut(ctx context.Context, notificationType string, accountIDs []int64) ([]int64, error)
	FilterOptedIn(ctx context.Context, notificationType string, accountIDs []int64) ([]int64, error)
}

// newTimetableRoomChangeNotices binds the notice over the root's
// notifications; nil without them.
func newTimetableRoomChangeNotices(notifications DeliveryNotifications, guardians peopledirectory.GuardianPortalContacts) timetablePorts.InstanceRoomChangeNotices {
	if notifications.Notifier == nil || notifications.Preferences == nil {
		return nil
	}
	return timetableRoomChangeNotices{notifier: notifications.Notifier, preferences: notifications.Preferences, guardians: guardians, now: time.Now}
}

func (n timetableRoomChangeNotices) NotifyInstanceRoomChanged(ctx context.Context, notice timetablePorts.InstanceRoomChangeNotice) error {
	title, body := roomChangeCopy(notice)
	if err := n.notifyStaff(ctx, notice, title, body); err != nil {
		return err
	}
	return n.notifyGuardians(ctx, notice, title, body)
}

// roomChangeTypes are the staff and the parent type of a move on the
// notice's day.
func roomChangeTypes(notice timetablePorts.InstanceRoomChangeNotice) (string, string) {
	if notice.Push == timetablePorts.RoomChangePushSoon {
		return deliveryContract.NotificationInstanceRoomChanged, deliveryContract.NotificationParentRoomChanged
	}
	return deliveryContract.NotificationInstanceRoomChangedLater, deliveryContract.NotificationParentRoomChangedLater
}

// pushRecipients narrows the recipients to whom a push may reach: a move
// soon drops explicit declines, a later one keeps explicit consents, a far
// one reaches nobody.
func (n timetableRoomChangeNotices) pushRecipients(ctx context.Context, push timetablePorts.RoomChangePush, notificationType string, accountIDs []int64) ([]int64, error) {
	switch push {
	case timetablePorts.RoomChangePushSoon:
		return n.preferences.FilterNotOptedOut(ctx, notificationType, accountIDs)
	case timetablePorts.RoomChangePushLater:
		return n.preferences.FilterOptedIn(ctx, notificationType, accountIDs)
	default:
		return nil, nil
	}
}

func (n timetableRoomChangeNotices) notifyStaff(ctx context.Context, notice timetablePorts.InstanceRoomChangeNotice, title, body string) error {
	if len(notice.StaffAccountIDs) == 0 {
		return nil
	}
	notificationType, _ := roomChangeTypes(notice)
	push, err := n.pushRecipients(ctx, notice.Push, notificationType, notice.StaffAccountIDs)
	if err != nil {
		return fmt.Errorf("room change notice: filter staff: %w", err)
	}
	err = n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
		Type: notificationType,
		// A block can move again and again; the moment keeps each move a
		// notice of its own, the feed bundles them within ten minutes.
		IdempotencyKey: fmt.Sprintf("%s:%d:%d", notificationType, notice.InstanceID, n.now().UnixNano()),
		RelatedType:    "activity_instance", RelatedID: notice.InstanceID,
		Title: title, Body: body, DeepLink: "/mein-dienstplan?d=" + notice.Date.String(), SchoolDeepLink: staffCancellationSchoolLink,
		Audience: deliveryCompose.NotificationAudience{
			TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: notice.StaffAccountIDs,
		},
		Feed: &deliveryContract.NotificationFeedDelivery{PushAccountIDs: push},
	})
	return roomChangeNotifyError(err)
}

// roomChangeParentLink leads a family to the children of the parents
// portal; the entry names the block, its day and its room.
const roomChangeParentLink = "/children"

// notifyGuardians writes the families' entry, one event per portal language
// so each lock-screen push speaks the family's language. The entry itself
// carries the German text of the staff entry: it names the block and the
// rooms, never a child, and is read only after login.
func (n timetableRoomChangeNotices) notifyGuardians(ctx context.Context, notice timetablePorts.InstanceRoomChangeNotice, title, body string) error {
	if n.guardians == nil || len(notice.StudentIDs) == 0 {
		return nil
	}
	guardianStudentIDs, localeOf, err := n.portalGuardians(ctx, notice.StudentIDs, notice.ActorAccountID)
	accountIDs := make([]int64, 0, len(guardianStudentIDs))
	for accountID := range guardianStudentIDs {
		accountIDs = append(accountIDs, accountID)
	}
	slices.Sort(accountIDs)
	if err != nil || len(accountIDs) == 0 {
		return err
	}
	_, notificationType := roomChangeTypes(notice)
	push, err := n.pushRecipients(ctx, notice.Push, notificationType, accountIDs)
	if err != nil {
		return fmt.Errorf("room change notice: filter guardians: %w", err)
	}
	byAudience := map[string]*guardianRoomChangeAudience{}
	for _, accountID := range accountIDs {
		studentIDs := guardianStudentIDs[accountID]
		key := roomChangeStudentScopeKey(studentIDs) + ":" + localeOf[accountID]
		if audience, ok := byAudience[key]; ok {
			audience.accountIDs = append(audience.accountIDs, accountID)
			continue
		}
		byAudience[key] = &guardianRoomChangeAudience{
			locale: localeOf[accountID], studentIDs: studentIDs, accountIDs: []int64{accountID},
		}
	}
	audienceKeys := make([]string, 0, len(byAudience))
	for key := range byAudience {
		audienceKeys = append(audienceKeys, key)
	}
	slices.Sort(audienceKeys)
	moment := n.now().UnixNano()
	for _, key := range audienceKeys {
		audience := byAudience[key]
		pushTitle, pushBody := deliveryCompose.ParentRoomChangedCopy(audience.locale)
		err := n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
			Type:           notificationType,
			IdempotencyKey: fmt.Sprintf("%s:%d:%d:%s:%s", notificationType, notice.InstanceID, moment, roomChangeStudentScopeDigest(audience.studentIDs), audience.locale),
			RelatedType:    "activity_instance", RelatedID: notice.InstanceID,
			Title: pushTitle, Body: pushBody, DeepLink: roomChangeParentLink,
			Audience: deliveryCompose.NotificationAudience{
				TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("guardian"),
				GuardianAccountIDs: audience.accountIDs, StudentIDs: audience.studentIDs,
			},
			Feed: &deliveryContract.NotificationFeedDelivery{
				PushAccountIDs: slices.DeleteFunc(slices.Clone(audience.accountIDs), func(id int64) bool { return !slices.Contains(push, id) }),
				Title:          title, Body: body,
			},
		})
		if err := roomChangeNotifyError(err); err != nil {
			return err
		}
	}
	return nil
}

// guardianRoomChangeAudience shares an event only between guardians with the
// same portal language and exactly the same authorized booked children.
type guardianRoomChangeAudience struct {
	locale                 string
	studentIDs, accountIDs []int64
}

func roomChangeStudentScopeKey(studentIDs []int64) string {
	parts := make([]string, len(studentIDs))
	for i, studentID := range studentIDs {
		parts[i] = strconv.FormatInt(studentID, 10)
	}
	return strings.Join(parts, ",")
}

// roomChangeStudentScopeDigest keeps the persisted idempotency key bounded
// while distinguishing every canonical authorized-child scope.
func roomChangeStudentScopeDigest(studentIDs []int64) string {
	canonical := slices.Clone(studentIDs)
	slices.Sort(canonical)
	return securityruntime.Fingerprint([]byte(roomChangeStudentScopeKey(canonical)))
}

// portalGuardians returns every account holding parent_portal.access for a
// booked child, with only the children it can access and the portal language.
// The actor is excluded. One batched read.
func (n timetableRoomChangeNotices) portalGuardians(ctx context.Context, studentIDs []int64, actorAccountID int64) (map[int64][]int64, map[int64]string, error) {
	contacts, err := n.guardians.ListGuardianPortalContacts(ctx, nil, studentIDs)
	if err != nil {
		return nil, nil, fmt.Errorf("room change notice: guardians: %w", err)
	}
	localeOf := map[int64]string{}
	guardianStudentIDs := map[int64][]int64{}
	for _, contact := range contacts {
		studentID, granted, err := roomChangeGuardianStudent(contact, actorAccountID)
		if err != nil {
			return nil, nil, err
		}
		if !granted {
			continue
		}
		if !slices.Contains(guardianStudentIDs[contact.AccountID], studentID) {
			guardianStudentIDs[contact.AccountID] = append(guardianStudentIDs[contact.AccountID], studentID)
		}
		if _, seen := localeOf[contact.AccountID]; !seen {
			locale := ""
			if contact.PortalLocale != nil {
				locale = *contact.PortalLocale
			}
			localeOf[contact.AccountID] = locale
		}
	}
	for accountID := range guardianStudentIDs {
		slices.Sort(guardianStudentIDs[accountID])
	}
	return guardianStudentIDs, localeOf, nil
}

func roomChangeGuardianStudent(contact peopledirectory.GuardianPortalContact, actorAccountID int64) (int64, bool, error) {
	if contact.StudentID == nil || contact.AccountID <= 0 || contact.AccountID == actorAccountID {
		return 0, false, nil
	}
	granted, err := guardianPortalAccessGranted(contact.PortalPermission)
	if err != nil || !granted {
		return 0, false, err
	}
	return *contact.StudentID, true, nil
}

// roomChangeNotifyError keeps a school's switched-off notifications a
// silent outcome.
func roomChangeNotifyError(err error) error {
	if err == nil || errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	return fmt.Errorf("room change notice: %w", err)
}

// roomChangeCopy is the display-safe text of the notice: the block's name,
// when it takes place and in which room, never a child.
func roomChangeCopy(notice timetablePorts.InstanceRoomChangeNotice) (string, string) {
	subject, when := blockNoticeSubject(notice.Title), blockNoticeWhen(notice.Date, notice.StartTime)
	room := strings.TrimSpace(notice.RoomName)
	if room == "" {
		return "Raum geändert", fmt.Sprintf("%s am %s findet in einem anderen Raum statt.", subject, when)
	}
	body := fmt.Sprintf("%s am %s findet jetzt in „%s“ statt", subject, when, room)
	if previous := strings.TrimSpace(notice.PreviousRoom); previous != "" {
		body += fmt.Sprintf(", nicht mehr in „%s“", previous)
	}
	return "Raum geändert", body + "."
}
