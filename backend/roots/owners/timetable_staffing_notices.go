package owners

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// TimetableStaffNotices are the notices Timetable writes into Delivery's
// notification feed: a cancelled block (#7148) and a staffing change
// (#7136). Their zero value tells nobody.
type TimetableStaffNotices struct {
	Cancellations timetablePorts.StaffCancellationNotices
	Staffing      timetablePorts.StaffingNoticeDependencies
}

// NewTimetableStaffNotices binds both notices over the root's notifications.
// The staffing notice names the teachers of a block's OGS groups through
// School Membership's teaching assignments and the groups through
// Timetable's own block groups. Without Delivery's notifications both stay
// nil.
func NewTimetableStaffNotices(notifications DeliveryNotifications, membership schoolmembership.Query, groups timetable.BlockGroupQuery) TimetableStaffNotices {
	cancellations := NewTimetableStaffCancellationNotices(notifications)
	if cancellations == nil {
		return TimetableStaffNotices{}
	}
	return TimetableStaffNotices{
		Cancellations: cancellations,
		Staffing: timetablePorts.StaffingNoticeDependencies{
			Notices: timetableStaffingNotices{
				notifier: notifications.Notifier, preferences: notifications.Preferences, now: time.Now,
			},
			Groups:   groups,
			Teachers: timetableGroupTeachers{membership: membership},
		},
	}
}

// timetableGroupTeachers names the teachers of OGS groups as staff ids: the
// group assignments, then the teachers' staff records, two batched reads.
type timetableGroupTeachers struct {
	membership interface {
		ListGroupAssignments(context.Context, schoolmembership.GroupAssignmentFilter) ([]schoolmembership.GroupAssignment, error)
		ListTeachers(context.Context, schoolmembership.TeacherFilter) ([]schoolmembership.Teacher, error)
	}
}

func (t timetableGroupTeachers) GroupTeacherStaffIDs(ctx context.Context, groupIDs []int64) (map[int64][]int64, error) {
	result := map[int64][]int64{}
	if len(groupIDs) == 0 {
		return result, nil
	}
	assignments, err := t.membership.ListGroupAssignments(ctx, schoolmembership.GroupAssignmentFilter{GroupIDs: groupIDs})
	if err != nil || len(assignments) == 0 {
		return result, err
	}
	teacherIDs := make([]int64, 0, len(assignments))
	for _, assignment := range assignments {
		teacherIDs = append(teacherIDs, assignment.TeacherID)
	}
	teachers, err := t.membership.ListTeachers(ctx, schoolmembership.TeacherFilter{IDs: teacherIDs})
	if err != nil {
		return nil, err
	}
	staffOf := make(map[int64]int64, len(teachers))
	for _, teacher := range teachers {
		staffOf[teacher.ID] = teacher.StaffID
	}
	for _, assignment := range assignments {
		if staffID, ok := staffOf[assignment.TeacherID]; ok {
			result[assignment.GroupID] = append(result[assignment.GroupID], staffID)
		}
	}
	return result, nil
}

// timetableStaffingNotices binds Timetable's staffing notice to Delivery's
// notification feed: one event per audience, the people concerned under
// their own type and the group's teachers under theirs. A push follows for
// whoever did not switch that type off while the change lies within the push
// window Timetable decided.
type timetableStaffingNotices struct {
	notifier    staffPushRouter
	preferences staffPushPreferences
	now         func() time.Time
}

// staffingAudience is one audience of a staffing notice with its copy.
type staffingAudience struct {
	role     string
	kind     string
	accounts []int64
	title    string
	body     string
	link     string
}

func (n timetableStaffingNotices) NotifyStaffingChanged(ctx context.Context, notice timetablePorts.StaffingNotice) error {
	for _, audience := range staffingAudiences(notice) {
		if len(audience.accounts) == 0 {
			continue
		}
		if err := n.notify(ctx, notice, audience); err != nil {
			return err
		}
	}
	return nil
}

func (n timetableStaffingNotices) notify(ctx context.Context, notice timetablePorts.StaffingNotice, audience staffingAudience) error {
	var push []int64
	if notice.Push {
		var err error
		if push, err = n.preferences.FilterNotOptedOut(ctx, audience.kind, audience.accounts); err != nil {
			return fmt.Errorf("staffing notice: filter recipients: %w", err)
		}
	}
	err := n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
		Type: audience.kind,
		// Every operation is a notice of its own; the moment keeps a later
		// change of the same object apart from this one.
		IdempotencyKey: fmt.Sprintf("%s:%s:%s:%d:%d", audience.kind, audience.role, notice.ObjectType, notice.ObjectID, n.now().UnixNano()),
		RelatedType:    notice.ObjectType, RelatedID: notice.ObjectID,
		Title: audience.title, Body: audience.body, DeepLink: audience.link,
		Audience: deliveryCompose.NotificationAudience{
			TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: audience.accounts,
		},
		Feed: &deliveryContract.NotificationFeedDelivery{PushAccountIDs: push},
	})
	if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("staffing notice: %w", err)
	}
	return nil
}

// staffingAudiences is the display-safe copy of a notice for each audience:
// who covers or is not there and when, never why. The people concerned land
// on their own Dienstplan on the first day, the teachers on the
// Vertretungsplan at the first block.
func staffingAudiences(notice timetablePorts.StaffingNotice) []staffingAudience {
	if len(notice.Days) == 0 {
		return nil
	}
	when := staffingWhen(notice.Days)
	subject, substitute := staffingName(notice.SubjectName), staffingName(notice.SubstituteName)
	own := "/mein-dienstplan?d=" + notice.Days[0].String()
	group := fmt.Sprintf("/vertretung?d=%s&block=%d", notice.Days[0].String(), notice.InstanceID)
	audience := func(role, kind string, accounts []int64, title, body, link string) staffingAudience {
		return staffingAudience{role: role, kind: kind, accounts: accounts, title: title, body: sentence(body), link: link}
	}
	ownKind, groupKind := deliveryContract.NotificationStaffingChanged, deliveryContract.NotificationGroupStaffingChanged
	switch notice.Kind {
	case timetablePorts.StaffingChangeSubstituted:
		return []staffingAudience{
			audience("substitute", ownKind, notice.SubstituteAccountIDs, "Sie vertreten", fmt.Sprintf("Sie vertreten %s %s", subject, when), own),
			audience("subject", ownKind, notice.SubjectAccountIDs, "Sie werden vertreten", fmt.Sprintf("%s vertritt Sie %s", substitute, when), own),
			audience("teacher", groupKind, notice.TeacherAccountIDs, "Vertretung in Ihrer Gruppe", fmt.Sprintf("%s vertritt %s %s", substitute, subject, when), group),
		}
	case timetablePorts.StaffingChangeAbsent:
		return []staffingAudience{
			audience("subject", ownKind, notice.SubjectAccountIDs, "Dienstplan geändert", fmt.Sprintf("Sie sind %s als nicht da eingetragen.", when), own),
			audience("teacher", groupKind, notice.TeacherAccountIDs, "Ausfall in Ihrer Gruppe", fmt.Sprintf("%s ist %s nicht da.", subject, when), group),
		}
	case timetablePorts.StaffingChangePresent:
		return []staffingAudience{
			audience("subject", ownKind, notice.SubjectAccountIDs, "Dienstplan geändert", fmt.Sprintf("Sie sind %s wieder eingeplant.", when), own),
			audience("teacher", groupKind, notice.TeacherAccountIDs, "Dienstplan geändert", fmt.Sprintf("%s ist %s doch da.", subject, when), group),
		}
	case timetablePorts.StaffingChangeSubstituteRemoved:
		return []staffingAudience{
			audience("subject", ownKind, notice.SubjectAccountIDs, "Vertretung entfällt", fmt.Sprintf("Sie vertreten %s nicht mehr.", when), own),
			audience("teacher", groupKind, notice.TeacherAccountIDs, "Vertretung entfällt", fmt.Sprintf("%s vertritt %s nicht mehr.", subject, when), group),
		}
	}
	return nil
}

// sentence starts the text with a capital, also with the fallback name, and
// ends it with one full stop: a single day already ends with one ("11.06.").
func sentence(text string) string {
	for i, r := range text {
		text = strings.ToUpper(string(r)) + text[i+len(string(r)):]
		break
	}
	if !strings.HasSuffix(text, ".") {
		text += "."
	}
	return text
}

// staffingName falls back to a neutral word for a person without a name.
func staffingName(name string) string {
	if name = strings.TrimSpace(name); name == "" {
		return "eine Person aus dem Team"
	}
	return name
}

// staffingWhen names the days: "am Mo. 17.11." for one day, "an 5 Tagen
// (17.–21.11.)" for several.
func staffingWhen(days []calendar.Date) string {
	first, last := days[0], days[len(days)-1]
	if len(days) == 1 {
		return "am " + staffCancellationWeekdays[first.Weekday()] + " " + first.Format("02.01.")
	}
	from := first.Format("02.01.")
	if first.Format("01.2006") == last.Format("01.2006") {
		from = first.Format("02.")
	}
	return fmt.Sprintf("an %d Tagen (%s–%s)", len(days), from, last.Format("02.01."))
}
