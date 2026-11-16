package owners

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The notices about a changed Stundenplan of a class (#7142). The people of
// a class are:
//
//   - the staff assigned to the class (education.class_teachers, the
//     Klassenzuweisungen of moto schule): its Lehrkräfte;
//   - the teachers of the OGS groups the children of the class belong to:
//     the staff that has the class's children in the afternoon;
//   - the guardians whose relationship to a child of the class grants
//     parent_portal.access, through the parent audience projection the
//     group threads use for a class.
//
// The person who made the change is the account of the request and gets
// nothing. Staff and families hear it in their own notification feed; the
// push follows the change's lead time and each person's choice.

// classTimetableRelatedType is the object a class's entries bundle on.
const classTimetableRelatedType = "school_class"

// classTimetableTitle is the title of every notice; the text says what.
const classTimetableTitle = "Stundenplan geändert"

// The lock-screen copy for families names no class: the class of a child is
// family data, the entry shows it after login.
const (
	classTimetableParentPushBody = "Der Unterrichtsschluss in der Klasse Ihres Kindes ändert sich. Mehr dazu in moto."
	classTimetableParentLink     = "/children"
)

// classTimetablePreferences is the consent the push of a notice follows: the
// default-on staff notice drops only declines, the others need a yes.
type classTimetablePreferences interface {
	FilterNotOptedOut(ctx context.Context, notificationType string, accountIDs []int64) ([]int64, error)
	FilterOptedIn(ctx context.Context, notificationType string, accountIDs []int64) ([]int64, error)
}

// classTimetableAudience lists the children of a class with their reachable
// guardians.
type classTimetableAudience interface {
	GroupAudience(ctx context.Context, schoolID int64, target communication.ParentGroupTarget) ([]communication.ParentGroupAudienceChild, error)
}

type classTimetableStudents interface {
	FindReadScopeByIDs(ctx context.Context, ids []int64) (map[int64]*peopleValues.StudentState, error)
}

type classTimetableStaffAccounts interface {
	ListAccountIDsByStaffIDs(ctx context.Context, staffIDs []int64) (map[int64]int64, error)
}

type classTimetableMembership interface {
	groupTeacherLister
	ListClassAssignments(ctx context.Context, filter schoolmembership.ClassAssignmentFilter) ([]schoolmembership.ClassAssignment, error)
}

// ClassTimetableNoticeSources are the owners the notices name the people of
// a class through.
type ClassTimetableNoticeSources struct {
	Audience   classTimetableAudience
	Students   classTimetableStudents
	Staff      classTimetableStaffAccounts
	Membership classTimetableMembership
}

// NewCarePlanClassTimetableNotices binds Care Plan's class timetable notices
// over the root's notifications. Without Delivery's notifications nobody is
// told.
func NewCarePlanClassTimetableNotices(notifications DeliveryNotifications, sources ClassTimetableNoticeSources) careplan.ClassTimetableNotices {
	if notifications.Notifier == nil || notifications.Preferences == nil {
		return nil
	}
	return classTimetableNotices{notifier: notifications.Notifier, preferences: notifications.Preferences, sources: sources, now: time.Now}
}

type classTimetableNotices struct {
	notifier    staffPushRouter
	preferences classTimetablePreferences
	sources     ClassTimetableNoticeSources
	now         func() time.Time
}

// classTimetablePeople are the accounts a notice reaches.
type classTimetablePeople struct {
	staff      []int64
	guardians  []int64
	studentIDs []int64
}

func (n classTimetableNotices) NotifyClassTimetableChanged(ctx context.Context, notice careplan.ClassTimetableNotice) error {
	class := strings.TrimSpace(notice.SchoolClass)
	if class == "" || notice.Day == "" {
		return errors.New("class timetable notice: class and day are required")
	}
	people, err := n.people(ctx, class)
	if err != nil {
		return fmt.Errorf("class timetable notice: recipients: %w", err)
	}
	body := classTimetableBody(class, notice)
	relatedID := classTimetableRelatedID(class)
	if err := n.notifyStaff(ctx, notice, people.staff, body, relatedID); err != nil {
		return err
	}
	return n.notifyFamilies(ctx, notice, people, body, relatedID)
}

// people names the staff and the families of the class, without the person
// who made the change: one read each for the children with their guardians,
// their groups, the class assignments, the group teachers and the accounts.
func (n classTimetableNotices) people(ctx context.Context, class string) (classTimetablePeople, error) {
	children, err := n.sources.Audience.GroupAudience(ctx, tenant.FromContext(ctx), communication.ParentGroupTarget{Type: "class", RefText: &class})
	if err != nil {
		return classTimetablePeople{}, err
	}
	var people classTimetablePeople
	for _, child := range children {
		people.studentIDs = append(people.studentIDs, child.StudentID)
		people.guardians = append(people.guardians, child.GuardianAccountIDs...)
	}
	staffIDs, err := n.classStaff(ctx, class, people.studentIDs)
	if err != nil {
		return classTimetablePeople{}, err
	}
	accounts, err := n.sources.Staff.ListAccountIDsByStaffIDs(ctx, staffIDs)
	if err != nil {
		return classTimetablePeople{}, err
	}
	for _, staffID := range staffIDs {
		if accountID, ok := accounts[staffID]; ok {
			people.staff = append(people.staff, accountID)
		}
	}
	actor := sessiontoken.ActorAccountIDFromCtx(ctx)
	people.staff = classTimetableAccounts(people.staff, actor)
	people.guardians = classTimetableAccounts(people.guardians, actor)
	slices.Sort(people.studentIDs)
	people.studentIDs = slices.Compact(people.studentIDs)
	return people, nil
}

// classStaff is the staff assigned to the class and the teachers of the OGS
// groups its children belong to.
func (n classTimetableNotices) classStaff(ctx context.Context, class string, studentIDs []int64) ([]int64, error) {
	assignments, err := n.sources.Membership.ListClassAssignments(ctx, schoolmembership.ClassAssignmentFilter{ClassKeys: []string{schoolstructure.NormalizeClass(class)}})
	if err != nil {
		return nil, err
	}
	staffIDs := make([]int64, 0, len(assignments))
	for _, assignment := range assignments {
		staffIDs = append(staffIDs, assignment.StaffID)
	}
	if len(studentIDs) == 0 {
		return staffIDs, nil
	}
	students, err := n.sources.Students.FindReadScopeByIDs(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	var groupIDs []int64
	for _, student := range students {
		if student != nil && student.GroupID != nil {
			groupIDs = append(groupIDs, *student.GroupID)
		}
	}
	slices.Sort(groupIDs)
	teachers, err := timetableGroupTeachers{membership: n.sources.Membership}.GroupTeacherStaffIDs(ctx, slices.Compact(groupIDs))
	if err != nil {
		return nil, err
	}
	for _, groupTeachers := range teachers {
		staffIDs = append(staffIDs, groupTeachers...)
	}
	slices.Sort(staffIDs)
	return slices.Compact(staffIDs), nil
}

// classTimetableAccounts is the sorted, distinct list without the actor.
func classTimetableAccounts(accounts []int64, actor *int64) []int64 {
	out := slices.DeleteFunc(slices.Clone(accounts), func(id int64) bool { return id <= 0 || (actor != nil && id == *actor) })
	slices.Sort(out)
	return slices.Compact(out)
}

func (n classTimetableNotices) notifyStaff(ctx context.Context, notice careplan.ClassTimetableNotice, accounts []int64, body string, relatedID int64) error {
	if len(accounts) == 0 {
		return nil
	}
	push, err := n.staffPush(ctx, notice.Push, accounts)
	if err != nil {
		return err
	}
	kind := deliveryContract.NotificationClassTimetableChanged
	return n.send(ctx, deliveryCompose.NotificationEvent{
		Type:           kind,
		IdempotencyKey: fmt.Sprintf("%s:%d:%d", kind, relatedID, n.now().UnixNano()),
		RelatedType:    classTimetableRelatedType, RelatedID: relatedID,
		Title: classTimetableTitle, Body: body,
		DeepLink:       "/tagesplan?d=" + notice.Day.String(),
		SchoolDeepLink: "/school/klasse?klasse=" + url.QueryEscape(strings.TrimSpace(notice.SchoolClass)) + "&tag=" + notice.Day.String(),
		Audience: deliveryCompose.NotificationAudience{
			TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("staff"), StaffAccountIDs: accounts,
		},
		Feed: &deliveryContract.NotificationFeedDelivery{PushAccountIDs: push},
	})
}

// staffPush is who of the staff a push may reach: today and tomorrow
// everyone who did not switch it off, 2 to 14 days ahead who switched the
// later days on, later nobody.
func (n classTimetableNotices) staffPush(ctx context.Context, reach string, accounts []int64) ([]int64, error) {
	var (
		push []int64
		err  error
	)
	switch reach {
	case careplan.ClassTimetablePushSoon:
		push, err = n.preferences.FilterNotOptedOut(ctx, deliveryContract.NotificationClassTimetableChanged, accounts)
	case careplan.ClassTimetablePushAhead:
		push, err = n.preferences.FilterOptedIn(ctx, deliveryContract.NotificationClassTimetableChangedAhead, accounts)
	}
	if err != nil {
		return nil, fmt.Errorf("class timetable notice: filter staff push: %w", err)
	}
	return push, nil
}

func (n classTimetableNotices) notifyFamilies(ctx context.Context, notice careplan.ClassTimetableNotice, people classTimetablePeople, body string, relatedID int64) error {
	if len(people.guardians) == 0 || len(people.studentIDs) == 0 {
		return nil
	}
	kind := deliveryContract.NotificationParentClassTimetableChanged
	var push []int64
	if notice.Push != careplan.ClassTimetablePushNone {
		var err error
		if push, err = n.preferences.FilterOptedIn(ctx, kind, people.guardians); err != nil {
			return fmt.Errorf("class timetable notice: filter family push: %w", err)
		}
	}
	return n.send(ctx, deliveryCompose.NotificationEvent{
		Type:           kind,
		IdempotencyKey: fmt.Sprintf("%s:%d:%d", kind, relatedID, n.now().UnixNano()),
		RelatedType:    classTimetableRelatedType, RelatedID: relatedID,
		Title: classTimetableTitle, Body: classTimetableParentPushBody, DeepLink: classTimetableParentLink,
		Audience: deliveryCompose.NotificationAudience{
			TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("guardian"),
			GuardianAccountIDs: people.guardians, StudentIDs: people.studentIDs,
		},
		Feed: &deliveryContract.NotificationFeedDelivery{PushAccountIDs: push, Title: classTimetableTitle, Body: body},
	})
}

func (n classTimetableNotices) send(ctx context.Context, event deliveryCompose.NotificationEvent) error {
	err := n.notifier.Notify(ctx, event)
	if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("class timetable notice: %w", err)
	}
	return nil
}

// classTimetableBody is the display-safe text of a change: the class, the
// day or the weekdays and the time, never a reason.
func classTimetableBody(class string, notice careplan.ClassTimetableNotice) string {
	label := classTimetableClassLabel(class)
	day := staffCancellationWeekdays[notice.Day.Weekday()] + " " + notice.Day.Format("02.01.")
	switch notice.Kind {
	case careplan.ClassTimetableDay:
		return fmt.Sprintf("%s hat am %s um %s Uhr Schluss.", label, day, notice.ArrivalTime)
	case careplan.ClassTimetableDayRemoved:
		return fmt.Sprintf("%s hat am %s wieder zur gewohnten Zeit Schluss.", label, day)
	}
	times := make([]string, 0, len(notice.Weekdays))
	for _, weekday := range notice.Weekdays {
		name := staffCancellationWeekdays[time.Weekday(weekday.Weekday)]
		if weekday.Time == "" {
			times = append(times, name+" keine feste Zeit mehr")
			continue
		}
		times = append(times, fmt.Sprintf("%s %s Uhr", name, weekday.Time))
	}
	// The day already ends with a full stop ("12.06.").
	return fmt.Sprintf("Neuer Unterrichtsschluss für %s: %s. Gilt ab %s", label, strings.Join(times, ", "), day)
}

// classTimetableClassLabel names the class as "Klasse 3a", also when the
// school entered the word itself.
func classTimetableClassLabel(class string) string {
	if strings.HasPrefix(strings.ToLower(class), "klasse") {
		return class
	}
	return "Klasse " + class
}

// classTimetableRelatedID is the stable object id of a class: a class has no
// row of its own, so its normalized name is hashed. Entries of one class in
// one school bundle on it.
func classTimetableRelatedID(class string) int64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(schoolstructure.NormalizeClass(class)))
	id := int64(hash.Sum64() & math.MaxInt64)
	if id == 0 {
		return 1
	}
	return id
}

// CarePlanClassTimetableNotices binds the notices over the root's owners:
// the parent audience projection, People Directory's students and staff
// accounts and School Membership's teaching assignments.
func CarePlanClassTimetableNotices(db transactionruntime.Database, notifications DeliveryNotifications, people PeopleRows, membership classTimetableMembership) careplan.ClassTimetableNotices {
	return NewCarePlanClassTimetableNotices(notifications, ClassTimetableNoticeSources{
		Audience: NewParentGroupAudience(db), Students: people.Students, Staff: people.Staff, Membership: membership,
	})
}
