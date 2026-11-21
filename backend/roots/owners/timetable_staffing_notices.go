package owners

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// TimetableStaffNotices are the notices Timetable writes into Delivery's
// notification feed: a cancelled block (#7148), a staffing change (#7136)
// and a colleague's absence to the team (#7138). Their zero value tells
// nobody.
type TimetableStaffNotices struct {
	Cancellations timetablePorts.StaffCancellationNotices
	Staffing      timetablePorts.StaffingNoticeDependencies
	// RoomChanges tells the staff of a block, and with the guardian contacts
	// the families of its children, that it moved to another room (#7141).
	RoomChanges timetablePorts.InstanceRoomChangeNotices
}

// WithGuardianContacts lets the room change notice reach the families too
// (#7141): the People Directory names the guardians of the booked children
// with their portal access and language.
func (n TimetableStaffNotices) WithGuardianContacts(guardians peopledirectory.GuardianPortalContacts) TimetableStaffNotices {
	if notices, ok := n.RoomChanges.(timetableRoomChangeNotices); ok && guardians != nil {
		notices.guardians = guardians
		n.RoomChanges = notices
	}
	return n
}

// NewTimetableStaffNotices binds both notices over the root's notifications.
// The staffing notice names the teachers of a block's OGS groups through
// School Membership's teaching assignments, the groups through Timetable's
// own block groups and the Gruppenübergaben through Workforce. Without
// Delivery's notifications both stay nil. A missing staffing dependency
// leaves only cancellation notices enabled.
func NewTimetableStaffNotices(notifications DeliveryNotifications, membership schoolmembership.Query, groups timetable.BlockGroupQuery, handovers groupSubstitutionLister) TimetableStaffNotices {
	cancellations := NewTimetableStaffCancellationNotices(notifications)
	if cancellations == nil {
		return TimetableStaffNotices{}
	}
	return TimetableStaffNotices{
		Cancellations: cancellations,
		Staffing:      newTimetableStaffingNoticeDependencies(notifications.Notifier, notifications.Preferences, membership, groups, handovers),
		RoomChanges:   newTimetableRoomChangeNotices(notifications, nil),
	}
}

func newTimetableStaffingNoticeDependencies(notifier staffPushRouter, preferences staffPushPreferences, membership groupTeacherLister, groups timetable.BlockGroupQuery, handovers groupSubstitutionLister) timetablePorts.StaffingNoticeDependencies {
	if notifier == nil || preferences == nil || membership == nil || groups == nil || handovers == nil {
		return timetablePorts.StaffingNoticeDependencies{}
	}
	return timetablePorts.StaffingNoticeDependencies{
		Notices: timetableStaffingNotices{
			notifier: notifier, preferences: preferences, now: time.Now,
		},
		Groups:    groups,
		Teachers:  timetableGroupTeachers{membership: membership},
		Handovers: timetableGroupHandovers{substitutions: handovers},
	}
}

// timetableGroupHandovers lists the Gruppenübergaben of OGS groups over a
// period in one Workforce read. Only Gruppenübergaben make somebody part of
// the group team; legacy personnel substitutions remain readable history.
type timetableGroupHandovers struct {
	substitutions groupSubstitutionLister
}

// groupSubstitutionLister is the Workforce read of the Gruppenübergaben.
type groupSubstitutionLister interface {
	ListGroupSubstitutions(context.Context, workforce.GroupSubstitutionFilter) ([]workforce.GroupSubstitution, error)
}

func (h timetableGroupHandovers) GroupHandovers(ctx context.Context, groupIDs []int64, from, to calendar.Date) ([]timetablePorts.GroupHandover, error) {
	if len(groupIDs) == 0 {
		return nil, nil
	}
	rows, err := h.substitutions.ListGroupSubstitutions(ctx, workforce.GroupSubstitutionFilter{
		GroupIDs: groupIDs, TargetType: workforce.GroupSubstitutionTypeGroupHandover,
		OverlapFrom: from.String(), OverlapTo: to.String(),
	})
	if err != nil {
		return nil, err
	}
	result := make([]timetablePorts.GroupHandover, 0, len(rows))
	for _, row := range rows {
		start, startErr := calendar.ParseDate(row.StartDate)
		end, endErr := calendar.ParseDate(row.EndDate)
		if startErr != nil || endErr != nil {
			return nil, fmt.Errorf("group handover %d: invalid period: %w", row.ID, errors.Join(startErr, endErr))
		}
		result = append(result, timetablePorts.GroupHandover{GroupID: row.GroupID, StaffID: row.SubstituteStaffID, From: start, To: end})
	}
	return result, nil
}

// GroupTeacherStaff names the teachers of OGS groups as staff ids. The staff
// notices (#7138) and "Heute anders" (#7659) read the same group team.
type GroupTeacherStaff interface {
	GroupTeacherStaffIDs(ctx context.Context, groupIDs []int64) (map[int64][]int64, error)
}

// NewGroupTeacherStaff reads the group teachers through School Membership.
func NewGroupTeacherStaff(membership schoolmembership.Query) GroupTeacherStaff {
	return timetableGroupTeachers{membership: membership}
}

// timetableGroupTeachers names the teachers of OGS groups as staff ids: the
// group assignments with their live teachers' staff records, one batched
// read (#7675, the query budget of "Heute anders").
type timetableGroupTeachers struct {
	membership groupTeacherLister
}

type groupTeacherLister interface {
	ListGroupAssignments(context.Context, schoolmembership.GroupAssignmentFilter) ([]schoolmembership.GroupAssignment, error)
}

func (t timetableGroupTeachers) GroupTeacherStaffIDs(ctx context.Context, groupIDs []int64) (map[int64][]int64, error) {
	result := map[int64][]int64{}
	if len(groupIDs) == 0 {
		return result, nil
	}
	assignments, err := t.membership.ListGroupAssignments(ctx, schoolmembership.GroupAssignmentFilter{GroupIDs: groupIDs, WithTeacherStaff: true})
	if err != nil {
		return nil, err
	}
	for _, assignment := range assignments {
		if assignment.TeacherStaffID > 0 {
			result[assignment.GroupID] = append(result[assignment.GroupID], assignment.TeacherStaffID)
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
// Vertretungsplan at the first block, the rest of the team on the Tagesplan.
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
	// The team holds the group by a handover and often lacks the right to
	// plan substitutions: its link opens the Tagesplan of the first day.
	day := "/tagesplan?d=" + notice.Days[0].String()
	ownKind, groupKind := deliveryContract.NotificationStaffingChanged, deliveryContract.NotificationGroupStaffingChanged
	teamKind := deliveryContract.NotificationTeamMemberAbsent
	switch notice.Kind {
	case timetablePorts.StaffingChangeSubstituted:
		return []staffingAudience{
			audience("substitute", ownKind, notice.SubstituteAccountIDs, "Du vertrittst", fmt.Sprintf("Du vertrittst %s %s", subject, when), own),
			audience("subject", ownKind, notice.SubjectAccountIDs, "Du wirst vertreten", fmt.Sprintf("%s vertritt dich %s", substitute, when), own),
			audience("teacher", groupKind, notice.TeacherAccountIDs, "Vertretung in deiner Gruppe", fmt.Sprintf("%s vertritt %s %s", substitute, subject, when), group),
		}
	case timetablePorts.StaffingChangeAbsent:
		return []staffingAudience{
			audience("subject", ownKind, notice.SubjectAccountIDs, "Dienstplan geändert", fmt.Sprintf("Du bist %s als nicht da eingetragen.", when), own),
			audience("teacher", groupKind, notice.TeacherAccountIDs, "Ausfall in deiner Gruppe", fmt.Sprintf("%s ist %s nicht da.", subject, when), group),
			audience("team", teamKind, notice.TeamAccountIDs, "Ausfall im Team", fmt.Sprintf("%s ist %s nicht da.", subject, when), day),
		}
	case timetablePorts.StaffingChangePresent:
		return []staffingAudience{
			audience("subject", ownKind, notice.SubjectAccountIDs, "Dienstplan geändert", fmt.Sprintf("Du bist %s wieder eingeplant.", when), own),
			audience("teacher", groupKind, notice.TeacherAccountIDs, "Dienstplan geändert", fmt.Sprintf("%s ist %s doch da.", subject, when), group),
			audience("team", teamKind, notice.TeamAccountIDs, "Dienstplan geändert", fmt.Sprintf("%s ist %s doch da.", subject, when), day),
		}
	case timetablePorts.StaffingChangeSubstituteRemoved:
		return []staffingAudience{
			audience("subject", ownKind, notice.SubjectAccountIDs, "Vertretung entfällt", fmt.Sprintf("Du vertrittst %s nicht mehr.", when), own),
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
