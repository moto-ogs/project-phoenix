package application

import (
	"context"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModel "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Staffing notices (#7136): a substitution or another change to who staffs a
// block tells the substitute, the substituted or absent person and the
// teachers of the affected OGS groups, never the person who made the change.
// Every write path of the staffing (single save, Sammel-Vertretung, the plan
// cascade of an absence) collects its changes and hands them over once, in
// its own transaction: a multi-day operation is one notice per person and
// kind, not one per day. The notice never carries an absence's reason.

// The objects a staffing notice is about: a save's first affected
// assignment, or the absence a cascade follows.
const (
	staffingObjectAssignment = "instance_staff"
	staffingObjectAbsence    = "staff_absence"
)

// staffingChange is one block of one person's change in an operation.
type staffingChange struct {
	kind         string
	subjectID    int64
	substituteID int64
	instanceID   int64
	date         calendar.Date
	start        time.Time
	// rowID is the subject's assignment the change is about.
	rowID int64
}

// staffingStoryKey groups the changes of one person and kind.
type staffingStoryKey struct {
	kind         string
	subjectID    int64
	substituteID int64
}

// staffingStory is what one notice tells: one person's change of one kind
// over the blocks of an operation.
type staffingStory struct {
	key     staffingStoryKey
	changes []staffingChange
}

// staffingOperation is one write's collected changes. objectType and
// objectID override the per-story assignment object (an absence's cascade).
type staffingOperation struct {
	changes    []staffingChange
	actor      *int64
	objectType string
	objectID   int64
}

func changeOf(kind string, subjectID, substituteID int64, row *scheduleModel.InstanceStaff, instance *scheduleModel.ActivityInstance) staffingChange {
	return staffingChange{
		kind: kind, subjectID: subjectID, substituteID: substituteID, instanceID: instance.ID,
		date: calendar.Date(instance.Date), start: instance.StartTime, rowID: row.ID,
	}
}

// deviationPlanChanges lists the changes a single save wrote.
func deviationPlanChanges(plan *deviationPlan) []staffingChange {
	changes := make([]staffingChange, 0, len(plan.absencePlan)+len(plan.presencePlan)+len(plan.subPlan)+len(plan.removalPlan))
	for _, op := range plan.presencePlan {
		changes = append(changes, changeOf(ports.StaffingChangePresent, op.row.StaffID, 0, op.row, op.instance))
	}
	for _, op := range plan.removalPlan {
		changes = append(changes, changeOf(ports.StaffingChangeSubstituteRemoved, op.row.StaffID, 0, op.row, op.instance))
	}
	return append(append(changes, absenceChanges(plan.absencePlan)...), substitutionChanges(plan.subPlan)...)
}

func absenceChanges(ops []deviationAbsenceOp) []staffingChange {
	changes := make([]staffingChange, 0, len(ops))
	for _, op := range ops {
		changes = append(changes, changeOf(ports.StaffingChangeAbsent, op.row.StaffID, 0, op.row, op.instance))
	}
	return changes
}

// substitutionChanges keeps the substitutions that changed something: a block
// the substitute already covered stays as it was.
func substitutionChanges(ops []deviationSubOp) []staffingChange {
	changes := make([]staffingChange, 0, len(ops))
	for _, op := range ops {
		if op.write.Action != timetable.SubstituteActionSubstituted && op.write.Action != timetable.SubstituteActionAlreadyOnInstance {
			continue
		}
		changes = append(changes, changeOf(ports.StaffingChangeSubstituted, op.write.OrigRow.StaffID, op.subID, op.write.OrigRow, op.write.Instance))
	}
	return changes
}

// NoticeSickAbsence tells about the blocks one absence's cascade marked
// absent: one notice about the absence, without its type or reason.
func (s *staffDeviations) NoticeSickAbsence(ctx context.Context, in timetable.SickAbsenceNotice) error {
	changes := make([]staffingChange, 0, len(in.Blocks))
	for _, block := range in.Blocks {
		changes = append(changes, staffingChange{
			kind: ports.StaffingChangeAbsent, subjectID: in.StaffID, instanceID: block.InstanceID, date: block.Date,
		})
	}
	return s.noticeStaffingChanges(ctx, staffingOperation{
		changes: changes, actor: in.ActorAccountID, objectType: staffingObjectAbsence, objectID: in.AbsenceID,
	})
}

// noticeStaffingChanges hands one notice per story to Delivery. It reads the
// blocks' groups, their teachers and every named person in three batched
// reads, whatever the operation's size.
func (s *staffDeviations) noticeStaffingChanges(ctx context.Context, op staffingOperation) error {
	deps := s.deps.StaffingNotices
	if deps.Notices == nil {
		return nil
	}
	today := calendar.DateFromTime(s.now())
	op.changes = slices.DeleteFunc(op.changes, func(change staffingChange) bool { return change.date.Before(today) })
	stories := staffingStories(op.changes)
	if len(stories) == 0 {
		return nil
	}
	teachersByBlock, err := s.blockTeachers(ctx, op.changes)
	if err != nil {
		return &ports.ScheduleError{Op: "staffing notice: group teachers", Err: err}
	}
	staff, err := s.deps.Staff.FindWithPersonByIDs(ctx, staffingStaffIDs(stories, teachersByBlock))
	if err != nil {
		return &ports.ScheduleError{Op: "staffing notice: staff", Err: err}
	}
	for _, story := range stories {
		notice := s.staffingNotice(story, op, today, teachersByBlock, staff)
		if len(notice.SubjectAccountIDs)+len(notice.SubstituteAccountIDs)+len(notice.TeacherAccountIDs) == 0 {
			continue
		}
		if err := deps.Notices.NotifyStaffingChanged(ctx, notice); err != nil {
			return &ports.ScheduleError{Op: "staffing notice", Err: err}
		}
	}
	return nil
}

// staffingStories groups the changes by person and kind, in the order of
// their first block.
func staffingStories(changes []staffingChange) []staffingStory {
	slices.SortStableFunc(changes, func(a, b staffingChange) int {
		if c := a.date.Compare(b.date); c != 0 {
			return c
		}
		return a.start.Compare(b.start)
	})
	index := map[staffingStoryKey]int{}
	var stories []staffingStory
	for _, change := range changes {
		key := staffingStoryKey{kind: change.kind, subjectID: change.subjectID, substituteID: change.substituteID}
		i, ok := index[key]
		if !ok {
			i = len(stories)
			index[key] = i
			stories = append(stories, staffingStory{key: key})
		}
		stories[i].changes = append(stories[i].changes, change)
	}
	return stories
}

// blockTeachers maps each block to the staff ids of its groups' teachers.
func (s *staffDeviations) blockTeachers(ctx context.Context, changes []staffingChange) (map[int64][]int64, error) {
	deps := s.deps.StaffingNotices
	instanceIDs := make([]int64, 0, len(changes))
	for _, change := range changes {
		if !slices.Contains(instanceIDs, change.instanceID) {
			instanceIDs = append(instanceIDs, change.instanceID)
		}
	}
	groupsByBlock, err := deps.Groups.BlockEducationGroups(ctx, instanceIDs)
	if err != nil {
		return nil, err
	}
	var groupIDs []int64
	for _, groups := range groupsByBlock {
		for _, groupID := range groups {
			if !slices.Contains(groupIDs, groupID) {
				groupIDs = append(groupIDs, groupID)
			}
		}
	}
	if len(groupIDs) == 0 {
		return map[int64][]int64{}, nil
	}
	teachersByGroup, err := deps.Teachers.GroupTeacherStaffIDs(ctx, groupIDs)
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]int64, len(groupsByBlock))
	for instanceID, groups := range groupsByBlock {
		for _, groupID := range groups {
			result[instanceID] = append(result[instanceID], teachersByGroup[groupID]...)
		}
	}
	return result, nil
}

// staffingStaffIDs lists every person a notice names or reaches.
func staffingStaffIDs(stories []staffingStory, teachersByBlock map[int64][]int64) []int64 {
	ids := map[int64]struct{}{}
	for _, story := range stories {
		ids[story.key.subjectID] = struct{}{}
		if story.key.substituteID > 0 {
			ids[story.key.substituteID] = struct{}{}
		}
	}
	for _, teachers := range teachersByBlock {
		for _, id := range teachers {
			ids[id] = struct{}{}
		}
	}
	out := make([]int64, 0, len(ids))
	for id := range ids {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

// staffingNotice builds one story's notice. The actor is in no list; a
// teacher who is also the subject or the substitute hears about it once, in
// their own role.
func (s *staffDeviations) staffingNotice(story staffingStory, op staffingOperation, today calendar.Date, teachersByBlock map[int64][]int64, staff map[int64]*timetable.StaffMember) ports.StaffingNotice {
	first := story.changes[0]
	notice := ports.StaffingNotice{
		Kind: story.key.kind, ObjectType: staffingObjectAssignment, ObjectID: first.rowID,
		SubjectName: staffName(staff[story.key.subjectID]), InstanceID: first.instanceID,
		Push: today.DaysUntil(first.date) <= staffNoticePushDays,
	}
	if op.objectType != "" {
		notice.ObjectType, notice.ObjectID = op.objectType, op.objectID
	}
	seen := map[int64]bool{}
	if op.actor != nil {
		seen[*op.actor] = true
	}
	reach := func(staffID int64) []int64 {
		accountID := staffAccount(staff[staffID])
		if accountID == 0 || seen[accountID] {
			return nil
		}
		seen[accountID] = true
		return []int64{accountID}
	}
	notice.SubjectAccountIDs = reach(story.key.subjectID)
	if story.key.substituteID > 0 {
		notice.SubstituteName = staffName(staff[story.key.substituteID])
		notice.SubstituteAccountIDs = reach(story.key.substituteID)
	}
	for _, change := range story.changes {
		if !slices.Contains(notice.Days, change.date) {
			notice.Days = append(notice.Days, change.date)
		}
		for _, teacherID := range teachersByBlock[change.instanceID] {
			notice.TeacherAccountIDs = append(notice.TeacherAccountIDs, reach(teacherID)...)
		}
	}
	return notice
}

func staffName(member *timetable.StaffMember) string {
	if member == nil || member.Person == nil {
		return ""
	}
	return member.Person.FullName()
}

func staffAccount(member *timetable.StaffMember) int64 {
	if member == nil || member.Person == nil || member.Person.AccountID == nil {
		return 0
	}
	return *member.Person.AccountID
}
