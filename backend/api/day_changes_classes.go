package api

// The classes of "Heute anders" (#7681). Two things are different for a whole
// class: it is on a trip, or its Unterrichtsschluss changes today.
//
// A class trip has no table of its own. A trip over the whole day is Care
// Plan's status day `class_trip` of each child; a day outing with a return
// time is each child's arrival exception with the reason "Ausflug" (#4799).
// Both belong to the Kinder source: it reads the status days anyway, and the
// children's class comes with their names in the same People Directory read.
// The Stundenplan der Klassen is a source of its own: Timetable's class-wide
// arrival exceptions of the day, for every class in one statement.
//
// Rule of both: users:read, the right of the child detail page and of the
// class arrival exceptions (GET /students/class-arrival-exceptions). Without
// it nothing of a class is visible, and the source stays loaded. The staff of
// a class (its class assignment, or for a trip the care staff of a child on
// it) sees the entry under "Betrifft dich", everybody else under "Schule".
// No child's name and no reason leaves this file.

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/classday"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesClassArrivals is Timetable's read of the class-wide arrival
// exceptions of every class on one day.
type dayChangesClassArrivals interface {
	ListClassArrivalExceptionsOn(ctx context.Context, date string) ([]timetable.ClassArrivalException, error)
}

// dayChangesAssignments is School Membership's read of the group assignments:
// the caller's own groups come from it in one statement by staff record.
type dayChangesAssignments interface {
	ListGroupAssignments(context.Context, schoolmembership.GroupAssignmentFilter) ([]schoolmembership.GroupAssignment, error)
}

// readsClasses is the rule of both class kinds: users:read, or admin.
func readsClasses(ctx context.Context) bool {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	return securityruntime.HasAdminWildcard(granted) || securityruntime.HasPermission(permissions.UsersRead, granted)
}

// classKey matches classes the way Timetable and People Directory do:
// trimmed and case-insensitive.
func classKey(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

// callerClasses are the caller's assigned classes as keys.
func callerClasses(ctx context.Context, caller dayChangesCaller) (map[string]bool, error) {
	classes, err := caller.MySchoolClasses(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve caller classes: %w", err)
	}
	keys := make(map[string]bool, len(classes))
	for _, class := range classes {
		keys[classKey(class)] = true
	}
	return keys, nil
}

// dayChangesClasses is the Stundenplan der Klassen.
type dayChangesClasses struct{ sources DayChangesSources }

func (s dayChangesClasses) ClassChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	if !readsClasses(ctx) {
		return nil, nil
	}
	rows, err := s.sources.ClassArrivals.ListClassArrivalExceptionsOn(ctx, day.String())
	if err != nil {
		return nil, fmt.Errorf("list class arrival exceptions: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	mine, err := callerClasses(ctx, s.sources.Caller)
	if err != nil {
		return nil, err
	}
	entries := make([]daychangesview.SourceEntry, 0, len(rows))
	for _, row := range rows {
		// The TIME column holds the wall clock itself; no zone applies.
		at := row.ArrivalTime.Format("15:04")
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindClassDismissalChanged, Involved: mine[classKey(row.SchoolClass)],
			Class: &daychangesview.DayClass{Name: strings.TrimSpace(row.SchoolClass), Time: &at},
		})
	}
	return entries, nil
}

// classTripChild is one child on a class trip today; returnAt is the return
// time of a day outing ("15:04"), empty for a trip over the whole day.
type classTripChild struct {
	studentID int64
	returnAt  string
}

// classTripChildren reads the trips of the day out of the status days the
// Kinder source holds and the day's arrival exceptions of a day outing. The
// reason of the outing stays here.
func classTripChildren(statusDays []careplan.StudentStatusDay, arrivals []careplan.ArrivalException) []classTripChild {
	trips := []classTripChild{}
	seen := map[int64]bool{}
	for _, day := range statusDays {
		if day.Status == careplan.StudentStatusDayClassTrip && !seen[day.StudentID] {
			seen[day.StudentID] = true
			trips = append(trips, classTripChild{studentID: day.StudentID})
		}
	}
	for _, arrival := range arrivals {
		if arrival.Reason == nil || arrival.ExpectedArrival == nil || !classday.IsClassTripArrival(*arrival.Reason) || seen[arrival.StudentID] {
			continue
		}
		seen[arrival.StudentID] = true
		trips = append(trips, classTripChild{studentID: arrival.StudentID, returnAt: arrival.ExpectedArrival.Format("15:04")})
	}
	return trips
}

// classTripKey is one class with one return time.
type classTripKey struct {
	class    string
	returnAt string
}

// classTripEntries sums the children on a trip up per class and return
// time. The staff of the class, or the care staff of one of its children on
// the trip, is involved.
func classTripEntries(trips []classTripChild, children map[int64]childRecord, ownGroups map[int64]bool, mine map[string]bool) []daychangesview.SourceEntry {
	entries := map[classTripKey]*daychangesview.SourceEntry{}
	order := []classTripKey{}
	for _, trip := range trips {
		record, known := children[trip.studentID]
		if !known || classKey(record.class) == "" {
			continue
		}
		key := classTripKey{class: classKey(record.class), returnAt: trip.returnAt}
		entry, ok := entries[key]
		if !ok {
			class := &daychangesview.DayClass{Name: strings.TrimSpace(record.class)}
			if trip.returnAt != "" {
				at := trip.returnAt
				class.Time = &at
			}
			entry = &daychangesview.SourceEntry{Kind: daychangesview.KindClassTrip, Class: class, Involved: mine[key.class]}
			entries[key] = entry
			order = append(order, key)
		}
		entry.Class.Children++
		if record.groupID != nil && ownGroups[*record.groupID] {
			entry.Involved = true
		}
	}
	sort.SliceStable(order, func(i, j int) bool {
		if order[i].class != order[j].class {
			return order[i].class < order[j].class
		}
		return order[i].returnAt < order[j].returnAt
	})
	result := make([]daychangesview.SourceEntry, 0, len(order))
	for _, key := range order {
		result = append(result, *entries[key])
	}
	return result
}

type dayChangesGroupMemoKey struct{}

// dayChangesGroupMemo holds the caller's teacher groups for the sources of
// one savepoint: the Personal and the Kinder source need the same groups.
type dayChangesGroupMemo struct {
	staffID int64
	groups  []int64
	read    bool
}

func withDayChangesGroupMemo(ctx context.Context) context.Context {
	return context.WithValue(ctx, dayChangesGroupMemoKey{}, &dayChangesGroupMemo{})
}

// teacherGroups are the groups of the staff member's teacher profile, read
// from School Membership in one statement by staff record (#7681). A deleted
// teacher has none.
func (sources DayChangesSources) teacherGroups(ctx context.Context, staffID int64) ([]int64, error) {
	memo, ok := ctx.Value(dayChangesGroupMemoKey{}).(*dayChangesGroupMemo)
	if ok && memo.read && memo.staffID == staffID {
		return memo.groups, nil
	}
	assignments, err := sources.Assignments.ListGroupAssignments(ctx, schoolmembership.GroupAssignmentFilter{
		TeacherStaffIDs: []int64{staffID}, WithTeacherStaff: true,
	})
	if err != nil {
		return nil, fmt.Errorf("resolve caller groups: %w", err)
	}
	set := map[int64]bool{}
	for _, assignment := range assignments {
		if assignment.TeacherStaffID == staffID {
			set[assignment.GroupID] = true
		}
	}
	groups := sortedIDs(set)
	if ok {
		memo.staffID, memo.groups, memo.read = staffID, groups, true
	}
	return groups, nil
}

// ownGroups are the groups of the Kinder source: the caller's teacher groups
// and the groups it covers on the day, as Identity & Access's own groups are.
func (s dayChangesChildren) ownGroups(ctx context.Context, day calendar.Date) (map[int64]bool, error) {
	own := map[int64]bool{}
	staffID, isStaff, err := s.sources.Caller.CurrentStaffID(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve caller staff: %w", err)
	}
	if !isStaff {
		return own, nil
	}
	groups, err := s.sources.teacherGroups(ctx, staffID)
	if err != nil {
		return nil, err
	}
	for _, id := range groups {
		own[id] = true
	}
	covers, err := s.sources.Workforce.ListGroupSubstitutions(ctx, workforce.GroupSubstitutionFilter{SubstituteStaffID: staffID, On: day.String()})
	if err != nil {
		return nil, fmt.Errorf("resolve caller covers: %w", err)
	}
	for _, cover := range covers {
		own[cover.GroupID] = true
	}
	return own, nil
}
