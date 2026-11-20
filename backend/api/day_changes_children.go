package api

// The Kinder source of "Heute anders" (#7665, ADR 0299). It reads Care
// Plan's status days, pickup exceptions, day departures and dated pickup
// notes of the day, the People Directory's names, groups and classes of these
// children and the group names, and applies the rule of the child detail
// page: only an account with users:read (or an admin) sees the status of a
// child, so without it the source has nothing to show. Children of the
// caller's groups stand one by one under "Betrifft dich"; the rest of the
// school is summed up per group, or per class for a child without a group.

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
)

// dayChangesCarePlan is the Care Plan read of the children's day values.
type dayChangesCarePlan interface {
	ListStudentStatusDays(context.Context, careplan.StudentStatusDayFilter) ([]careplan.StudentStatusDay, error)
	ListPickupExceptions(context.Context, careplan.StudentScheduleFilter) ([]careplan.PickupException, error)
	ListPickupNotes(context.Context, careplan.StudentScheduleFilter) ([]careplan.PickupNote, error)
	ListDepartureExceptions(context.Context, careplan.StudentScheduleFilter) ([]careplan.DepartureException, error)
}

// dayChangesStudents is the People Directory read of the children.
type dayChangesStudents interface {
	ListStudentsByID(context.Context, []int64) ([]peopledirectory.Student, error)
	ListStudentNamesByID(context.Context, []int64) ([]peopledirectory.StudentName, error)
}

// dayChangesChildren is the Kinder source.
type dayChangesChildren struct{ sources DayChangesSources }

// ChildrenVisible is the rule of the child detail page: the status of a
// child needs users:read. It reads the session only, no statement.
func (dayChangesChildren) ChildrenVisible(ctx context.Context) bool {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	return securityruntime.HasAdminWildcard(granted) || securityruntime.HasPermission(permissions.UsersRead, granted)
}

// childChange is one thing different today for one child.
type childChange struct {
	kind  daychangesview.Kind
	child daychangesview.Child
}

func (s dayChangesChildren) ChildChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	if !s.ChildrenVisible(ctx) {
		return nil, nil
	}
	changes, err := s.changes(ctx, day)
	if err != nil || len(changes) == 0 {
		return nil, err
	}
	ids := make(map[int64]bool, len(changes))
	for _, change := range changes {
		ids[change.child.StudentID] = true
	}
	children, err := s.children(ctx, sortedIDs(ids))
	if err != nil {
		return nil, err
	}
	ownGroups, err := s.sources.Caller.MyGroupIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve caller groups: %w", err)
	}
	builder := newChildEntryBuilder(children, ownGroups)
	for _, change := range changes {
		builder.add(change)
	}
	return builder.finish(ctx, s.sources.Groups)
}

// changes reads the four kinds of the day, each in one statement for the
// whole school, in the order of the kinds.
func (s dayChangesChildren) changes(ctx context.Context, day calendar.Date) ([]childChange, error) {
	date := careplan.Date(day.String())
	statusDays, err := s.sources.CarePlan.ListStudentStatusDays(ctx, careplan.StudentStatusDayFilter{Date: date, ActiveOnly: true})
	if err != nil {
		return nil, fmt.Errorf("list status days: %w", err)
	}
	exceptions, err := s.sources.CarePlan.ListPickupExceptions(ctx, careplan.StudentScheduleFilter{Date: date})
	if err != nil {
		return nil, fmt.Errorf("list pickup exceptions: %w", err)
	}
	departures, err := s.sources.CarePlan.ListDepartureExceptions(ctx, careplan.StudentScheduleFilter{Date: date})
	if err != nil {
		return nil, fmt.Errorf("list day departures: %w", err)
	}
	notes, err := s.sources.CarePlan.ListPickupNotes(ctx, careplan.StudentScheduleFilter{Date: date})
	if err != nil {
		return nil, fmt.Errorf("list pickup notes: %w", err)
	}
	absent := map[int64]bool{}
	changes := absentChildren(statusDays, absent)
	changes = append(changes, pickupChanges(exceptions, absent)...)
	for _, departure := range departures {
		if departure.DepartureMode == careplan.DepartureModeAlone {
			changes = append(changes, childChange{kind: daychangesview.KindChildGoesAlone, child: daychangesview.Child{StudentID: departure.StudentID}})
		}
	}
	for _, note := range notes {
		// A date filter also returns the weekday notes; only the note of
		// this day is a change.
		if note.NoteDate == date && note.Content != "" {
			content := note.Content
			changes = append(changes, childChange{kind: daychangesview.KindChildPickupNote, child: daychangesview.Child{StudentID: note.StudentID, Note: &content}})
		}
	}
	return changes, nil
}

// absentChildren keeps one status per child, sick before excused, as on the
// detail page. A class trip belongs to the school source (#7664). The
// status's note never leaves the source.
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
		changes = append(changes, childChange{kind: daychangesview.KindChildAbsent, child: daychangesview.Child{StudentID: id, Status: &value}})
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
		child := daychangesview.Child{StudentID: exception.StudentID}
		if exception.PickupTime != nil {
			// The TIME column holds the wall clock itself; no zone applies.
			at := exception.PickupTime.Format("15:04")
			child.PickupTime = &at
		}
		changes = append(changes, childChange{kind: daychangesview.KindChildPickupChanged, child: child})
	}
	return changes
}

// childRecord is what the source needs to know about a child.
type childRecord struct {
	first, last string
	groupID     *int64
	class       string
}

// children reads the group, class and name of every child in two
// statements. A child the directory does not know stays out.
func (s dayChangesChildren) children(ctx context.Context, ids []int64) (map[int64]childRecord, error) {
	students, err := s.sources.Students.ListStudentsByID(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list students: %w", err)
	}
	names, err := s.sources.Students.ListStudentNamesByID(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list student names: %w", err)
	}
	records := make(map[int64]childRecord, len(students))
	for _, student := range students {
		records[student.ID] = childRecord{groupID: student.GroupID, class: student.SchoolClass}
	}
	for _, name := range names {
		if record, ok := records[name.StudentID]; ok {
			record.first, record.last = name.FirstName, name.LastName
			records[name.StudentID] = record
		}
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

func newChildEntryBuilder(children map[int64]childRecord, ownGroups []int64) *childEntryBuilder {
	own := make(map[int64]bool, len(ownGroups))
	for _, id := range ownGroups {
		own[id] = true
	}
	return &childEntryBuilder{
		children: children, ownGroups: own,
		summaries: map[childSummaryKey]*daychangesview.ChildSummary{}, groupIDs: map[int64]bool{},
	}
}

func (b *childEntryBuilder) add(change childChange) {
	record, known := b.children[change.child.StudentID]
	if !known {
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
				Group: &daychangesview.Group{ID: *record.groupID},
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
		entries[i].Group.Name = names[entries[i].Group.ID]
	}
	for key, summary := range b.summaries {
		sort.SliceStable(summary.Items, func(i, j int) bool {
			return childName(summary.Items[i].Child) < childName(summary.Items[j].Child)
		})
		entry := daychangesview.SourceEntry{Kind: daychangesview.KindChildSummary, ChildSummary: summary}
		if key.groupID != 0 {
			entry.Group = &daychangesview.Group{ID: key.groupID, Name: names[key.groupID]}
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
