package api

// The Kinder source of "Heute anders" (#7665, ADR 0299). It reads Care
// Plan's status days, pickup exceptions, day departures and pickup notes that
// apply on the day, the People Directory's names, groups and classes of these
// children and the group names, and applies the rule of the child detail
// page: only an account with users:read (or an admin) sees the status of a
// child, so without it the source has nothing to show. Children of the
// caller's groups stand one by one under "Betrifft dich"; the rest of the
// school is summed up per group, or per class for a child without a group.
// The class trips of the day come from the same reads (#7681,
// day_changes_classes.go).

import (
	"context"
	"fmt"
	"sort"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// dayChangesCarePlan is the Care Plan read of the children's day values.
type dayChangesCarePlan interface {
	ListStudentStatusDays(context.Context, careplan.StudentStatusDayFilter) ([]careplan.StudentStatusDay, error)
	ListPickupExceptions(context.Context, careplan.StudentScheduleFilter) ([]careplan.PickupException, error)
	ListPickupNotes(context.Context, careplan.StudentScheduleFilter) ([]careplan.PickupNote, error)
	ListDepartureExceptions(context.Context, careplan.StudentScheduleFilter) ([]careplan.DepartureException, error)
	// ListArrivalExceptions reads the day outings of a class (#7681).
	ListArrivalExceptions(context.Context, careplan.StudentScheduleFilter) ([]careplan.ArrivalException, error)
}

// dayChangesDayPickups is the Care Plan read of the day's Abholart and
// pickup person in one statement (#7655).
type dayChangesDayPickups interface {
	ListDayPickups(ctx context.Context, from, to calendar.Date, studentIDs []int64) ([]careplan.DayPickup, error)
}

// dayChangesStudents is the People Directory read of the children: names,
// class and group in one statement (#7681). Class trips retain the placement
// of a deleted person, but normal child changes do not display that person.
type dayChangesStudents interface {
	ListStudentNamesByID(context.Context, []int64) ([]peopledirectory.StudentName, error)
}

// dayChangesChildren is the Kinder source.
type dayChangesChildren struct{ sources DayChangesSources }

// childrenVisible is the rule of the child detail page: the status of a
// child needs users:read and a verified staff record, unless the caller is
// an admin.
func (s dayChangesChildren) childrenVisible(ctx context.Context) (bool, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	if securityruntime.HasAdminWildcard(granted) {
		return true, nil
	}
	if !securityruntime.HasPermission(permissions.UsersRead, granted) {
		return false, nil
	}
	_, staff, err := s.sources.Caller.CurrentStaffID(ctx)
	if err != nil {
		return false, fmt.Errorf("resolve caller staff: %w", err)
	}
	return staff, nil
}

// childChange is one thing different today for one child.
type childChange struct {
	kind  daychangesview.Kind
	child daychangesview.Child
}

func (s dayChangesChildren) ChildChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	visible, err := s.childrenVisible(ctx)
	if err != nil {
		return nil, err
	}
	if !visible {
		return nil, nil
	}
	changes, trips, err := s.changes(ctx, day)
	if err != nil || len(changes)+len(trips) == 0 {
		return nil, err
	}
	ids := make(map[int64]bool, len(changes)+len(trips))
	for _, change := range changes {
		ids[change.child.StudentID.Int64()] = true
	}
	for _, trip := range trips {
		ids[trip.studentID] = true
	}
	children, err := s.children(ctx, sortedIDs(ids))
	if err != nil {
		return nil, err
	}
	ownGroups, err := s.ownGroups(ctx, day)
	if err != nil {
		return nil, err
	}
	builder := newChildEntryBuilder(children, ownGroups)
	for _, change := range changes {
		builder.add(change)
	}
	entries, err := builder.finish(ctx, s.sources.Groups)
	if err != nil || len(trips) == 0 {
		return entries, err
	}
	mine, err := callerClasses(ctx, s.sources.Caller)
	if err != nil {
		return nil, err
	}
	return append(entries, classTripEntries(trips, children, ownGroups, mine)...), nil
}

// changes reads the four kinds of the day and the day outings, each in one
// statement for the whole school, in the order of the kinds, and the
// children on a class trip (#7681).
func (s dayChangesChildren) changes(ctx context.Context, day calendar.Date) ([]childChange, []classTripChild, error) {
	date := careplan.Date(day.String())
	statusDays, err := s.sources.CarePlan.ListStudentStatusDays(ctx, careplan.StudentStatusDayFilter{Date: date, ActiveOnly: true})
	if err != nil {
		return nil, nil, fmt.Errorf("list status days: %w", err)
	}
	exceptions, err := s.sources.CarePlan.ListPickupExceptions(ctx, careplan.StudentScheduleFilter{Date: date})
	if err != nil {
		return nil, nil, fmt.Errorf("list pickup exceptions: %w", err)
	}
	pickups, err := s.sources.DayPickups.ListDayPickups(ctx, day, day, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("list day pickups: %w", err)
	}
	notes, err := s.sources.CarePlan.ListPickupNotes(ctx, careplan.StudentScheduleFilter{Date: date})
	if err != nil {
		return nil, nil, fmt.Errorf("list pickup notes: %w", err)
	}
	arrivals, err := s.sources.CarePlan.ListArrivalExceptions(ctx, careplan.StudentScheduleFilter{Date: date})
	if err != nil {
		return nil, nil, fmt.Errorf("list arrival exceptions: %w", err)
	}
	absent := map[int64]bool{}
	changes := absentChildren(statusDays, absent)
	changes = append(changes, pickupChanges(exceptions, absent)...)
	changes = append(changes, dayPickupChanges(pickups)...)
	for _, note := range notes {
		// A date filter returns dated notes and recurring weekday notes that
		// apply on this day. The latter have no NoteDate.
		if (note.NoteDate == date || note.Weekday != 0) && note.Content != "" {
			content := note.Content
			changes = append(changes, childChange{kind: daychangesview.KindChildPickupNote, child: daychangesview.Child{StudentID: ident.ID(note.StudentID), Note: &content}})
		}
	}
	return changes, classTripChildren(statusDays, arrivals), nil
}

// absentChildren keeps one status per child, sick before excused, as on the
// detail page. A class trip is an entry of its class (#7681). The status's
// note never leaves the source.
func absentChildren(days []careplan.StudentStatusDay, absent map[int64]bool) []childChange {
	status := map[int64]daychangesview.ChildStatus{}
	order := []int64{}
	for _, day := range days {
		var next daychangesview.ChildStatus
		switch day.Status {
		case careplan.StudentStatusDaySick:
			next = daychangesview.ChildSick
		case careplan.StudentStatusDayExcused:
			next = daychangesview.ChildExcused
		default:
			continue
		}
		current, seen := status[day.StudentID]
		if !seen {
			order = append(order, day.StudentID)
		}
		if !seen || current != daychangesview.ChildSick {
			status[day.StudentID] = next
		}
	}
	changes := make([]childChange, 0, len(order))
	for _, id := range order {
		value := status[id]
		absent[id] = true
		changes = append(changes, childChange{kind: daychangesview.KindChildAbsent, child: daychangesview.Child{StudentID: ident.ID(id), Status: &value}})
	}
	return changes
}

// pickupChanges turns the day's pickup exceptions into changed pickup
// times. An exception without a time means the child does not come; for a
// child already reported absent that says nothing new. The reason stays out.
func pickupChanges(exceptions []careplan.PickupException, absent map[int64]bool) []childChange {
	changes := make([]childChange, 0, len(exceptions))
	for _, exception := range exceptions {
		if exception.PickupTime == nil && absent[exception.StudentID] {
			continue
		}
		child := daychangesview.Child{StudentID: ident.ID(exception.StudentID)}
		if exception.PickupTime != nil {
			// The TIME column holds the wall clock itself; no zone applies.
			at := exception.PickupTime.Format("15:04")
			child.PickupTime = &at
		}
		changes = append(changes, childChange{kind: daychangesview.KindChildPickupChanged, child: child})
	}
	return changes
}

// dayPickupChanges turns the day's Abholart into "goes alone" and the day's
// pickup person into its own entry (#7655), in that order per child.
func dayPickupChanges(pickups []careplan.DayPickup) []childChange {
	changes := make([]childChange, 0, len(pickups))
	for _, pickup := range pickups {
		if pickup.Departure != nil && pickup.Departure.DepartureMode == careplan.DepartureModeAlone {
			changes = append(changes, childChange{kind: daychangesview.KindChildGoesAlone, child: daychangesview.Child{StudentID: ident.ID(pickup.StudentID)}})
		}
		if pickup.Person != nil {
			person := daychangesview.ChildPickupPerson{Name: pickup.Person.Name, OneTime: pickup.Person.OneTime(), PermissionWithdrawn: pickup.Person.PermissionWithdrawn}
			changes = append(changes, childChange{kind: daychangesview.KindChildPickupPerson, child: daychangesview.Child{StudentID: ident.ID(pickup.StudentID), PickupPerson: &person}})
		}
	}
	return changes
}

// childRecord is what the source needs to know about a child.
type childRecord struct {
	first, last   string
	groupID       *int64
	class         string
	personDeleted bool
}

// children reads the group, class and name of every child in one statement
// (#7681). A deleted person remains only for a class-trip count, never a
// normal child change.
func (s dayChangesChildren) children(ctx context.Context, ids []int64) (map[int64]childRecord, error) {
	names, err := s.sources.Students.ListStudentNamesByID(peopledirectory.WithDeletedStudentPlacements(ctx), ids)
	if err != nil {
		return nil, fmt.Errorf("list student names: %w", err)
	}
	records := make(map[int64]childRecord, len(names))
	for _, name := range names {
		records[name.StudentID] = childRecord{first: name.FirstName, last: name.LastName, groupID: name.GroupID, class: name.SchoolClass, personDeleted: name.PersonDeleted}
	}
	return records, nil
}

// childSummaryKey is one group, or one class for children without a group.
type childSummaryKey struct {
	groupID int64
	class   string
}

// childEntryBuilder puts the children of the caller's groups one by one and
// sums up the others per group or class.
type childEntryBuilder struct {
	children  map[int64]childRecord
	ownGroups map[int64]bool
	own       []daychangesview.SourceEntry
	summaries map[childSummaryKey]*daychangesview.ChildSummary
	groupIDs  map[int64]bool
}

func newChildEntryBuilder(children map[int64]childRecord, ownGroups map[int64]bool) *childEntryBuilder {
	return &childEntryBuilder{
		children: children, ownGroups: ownGroups,
		summaries: map[childSummaryKey]*daychangesview.ChildSummary{}, groupIDs: map[int64]bool{},
	}
}

func (b *childEntryBuilder) add(change childChange) {
	record, known := b.children[change.child.StudentID.Int64()]
	if !known || record.personDeleted {
		return
	}
	child := change.child
	child.FirstName, child.LastName = record.first, record.last
	studentID := child.StudentID
	link := &daychangesview.Link{Target: daychangesview.LinkStudent, StudentID: &studentID}
	if record.groupID != nil {
		b.groupIDs[*record.groupID] = true
		if b.ownGroups[*record.groupID] {
			b.own = append(b.own, daychangesview.SourceEntry{
				Kind: change.kind, Involved: true, Child: &child, Link: link,
				Group: &daychangesview.Group{ID: ident.ID(*record.groupID)},
			})
			return
		}
	}
	summary := b.summary(record)
	summary.Items = append(summary.Items, daychangesview.ChildItem{Kind: change.kind, Child: child, Link: link})
	countChild(&summary.Counts, change)
}

func (b *childEntryBuilder) summary(record childRecord) *daychangesview.ChildSummary {
	key := childSummaryKey{class: record.class}
	if record.groupID != nil {
		key = childSummaryKey{groupID: *record.groupID}
	}
	summary, ok := b.summaries[key]
	if !ok {
		summary = &daychangesview.ChildSummary{SchoolClass: key.class, Items: []daychangesview.ChildItem{}}
		b.summaries[key] = summary
	}
	return summary
}

func countChild(counts *daychangesview.ChildCounts, change childChange) {
	switch change.kind {
	case daychangesview.KindChildAbsent:
		if change.child.Status != nil && *change.child.Status == daychangesview.ChildSick {
			counts.Sick++
		} else {
			counts.Excused++
		}
	case daychangesview.KindChildPickupChanged:
		counts.PickupChanged++
	case daychangesview.KindChildGoesAlone:
		counts.GoesAlone++
	case daychangesview.KindChildPickupNote:
		counts.PickupNote++
	case daychangesview.KindChildPickupPerson:
		counts.PickupPerson++
	}
}

// finish names the groups in one read and returns the own children and one
// summary per group or class; the projection sorts them.
func (b *childEntryBuilder) finish(ctx context.Context, groups dayChangesGroups) ([]daychangesview.SourceEntry, error) {
	names, err := childGroupNames(ctx, groups, b.groupIDs)
	if err != nil {
		return nil, err
	}
	entries := b.own
	for i := range entries {
		entries[i].Group.Name = names[entries[i].Group.ID.Int64()]
	}
	for key, summary := range b.summaries {
		sort.SliceStable(summary.Items, func(i, j int) bool {
			return childName(summary.Items[i].Child) < childName(summary.Items[j].Child)
		})
		entry := daychangesview.SourceEntry{Kind: daychangesview.KindChildSummary, ChildSummary: summary}
		if key.groupID != 0 {
			entry.Group = &daychangesview.Group{ID: ident.ID(key.groupID), Name: names[key.groupID]}
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func childGroupNames(ctx context.Context, groups dayChangesGroups, ids map[int64]bool) (map[int64]string, error) {
	names := map[int64]string{}
	if len(ids) == 0 {
		return names, nil
	}
	rows, err := groups.FindByIDs(ctx, sortedIDs(ids))
	if err != nil {
		return nil, fmt.Errorf("resolve group names: %w", err)
	}
	for id, row := range rows {
		if row != nil {
			names[id] = row.Name
		}
	}
	return names, nil
}

func childName(child daychangesview.Child) string { return child.FirstName + " " + child.LastName }
