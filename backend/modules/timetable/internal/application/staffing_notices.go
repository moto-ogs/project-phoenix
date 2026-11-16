package application

import (
	"context"
	"math"
	"math/rand/v2"
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

// staffingObjectStory is what a staffing notice is about: one person's one
// kind of change in a write. Days of that story share one entry, while another
// story in the same write remains independently visible to overlapping
// recipients.
const staffingObjectStory = "staffing_story"

// staffingChange is one block of one person's change in an operation.
type staffingChange struct {
	kind         string
	subjectID    int64
	substituteID int64
	instanceID   int64
	date         calendar.Date
	start        time.Time
	// knownAbsent marks a substitution of a person who was already absent:
	// no new absence for the team.
	knownAbsent bool
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

// staffingOperation is one write's collected changes.
type staffingOperation struct {
	changes []staffingChange
	actor   *int64
}

func changeOf(kind string, subjectID, substituteID int64, instance *scheduleModel.ActivityInstance) staffingChange {
	return staffingChange{
		kind: kind, subjectID: subjectID, substituteID: substituteID, instanceID: instance.ID,
		date: calendar.Date(instance.Date), start: instance.StartTime,
	}
}

// deviationPlanChanges lists the changes a single save wrote.
func deviationPlanChanges(plan *deviationPlan) []staffingChange {
	changes := make([]staffingChange, 0, len(plan.absencePlan)+len(plan.presencePlan)+len(plan.subPlan)+len(plan.removalPlan))
	for _, op := range plan.presencePlan {
		changes = append(changes, changeOf(ports.StaffingChangePresent, op.row.StaffID, 0, op.instance))
	}
	for _, op := range plan.removalPlan {
		changes = append(changes, changeOf(ports.StaffingChangeSubstituteRemoved, op.row.StaffID, 0, op.instance))
	}
	return append(append(changes, absenceChanges(plan.absencePlan)...), substitutionChanges(plan.subPlan)...)
}

func absenceChanges(ops []deviationAbsenceOp) []staffingChange {
	changes := make([]staffingChange, 0, len(ops))
	for _, op := range ops {
		changes = append(changes, changeOf(ports.StaffingChangeAbsent, op.row.StaffID, 0, op.instance))
	}
	return changes
}

// substitutionChanges keeps the staffing changes that changed something. A
// planned co-supervisor is not a new substitute: only the original person's
// absence changes in that case.
func substitutionChanges(ops []deviationSubOp) []staffingChange {
	changes := make([]staffingChange, 0, len(ops))
	for _, op := range ops {
		switch op.write.Action {
		case timetable.SubstituteActionSubstituted:
			change := changeOf(ports.StaffingChangeSubstituted, op.write.OrigRow.StaffID, op.subID, op.write.Instance)
			change.knownAbsent = op.wasAbsent
			changes = append(changes, change)
		case timetable.SubstituteActionAlreadyOnInstance:
			change := changeOf(ports.StaffingChangeAbsent, op.write.OrigRow.StaffID, 0, op.write.Instance)
			change.knownAbsent = op.wasAbsent
			changes = append(changes, change)
		}
	}
	return changes
}

// NoticeSickAbsence tells about the blocks one pass of an absence's cascade
// marked absent or restored: one notice, without the absence's type or
// reason.
func (s *staffDeviations) NoticeSickAbsence(ctx context.Context, in timetable.SickAbsenceNotice) error {
	kind := ports.StaffingChangeAbsent
	if in.Returned {
		kind = ports.StaffingChangePresent
	}
	changes := make([]staffingChange, 0, len(in.Blocks))
	for _, block := range in.Blocks {
		changes = append(changes, staffingChange{kind: kind, subjectID: in.StaffID, instanceID: block.InstanceID, date: block.Date})
	}
	return s.noticeStaffingChanges(ctx, staffingOperation{changes: changes, actor: in.ActorAccountID})
}

// noticeStaffingChanges hands one notice per story to Delivery, then one per
// absence or return to the rest of the groups' team (#7138). It reads the
// blocks' groups, their teachers and handovers and every named person in
// four batched reads, whatever the operation's size.
func (s *staffDeviations) noticeStaffingChanges(ctx context.Context, op staffingOperation) error {
	deps := s.deps.StaffingNotices
	if deps.Notices == nil {
		return nil
	}
	today := calendar.DateFromTime(s.now())
	op.changes = slices.DeleteFunc(op.changes, func(change staffingChange) bool { return change.date.Before(today) })
	sortStaffingChanges(op.changes)
	stories := staffingStories(op.changes)
	if len(stories) == 0 {
		return nil
	}
	team, err := s.blockTeams(ctx, op.changes)
	if err != nil {
		return &ports.ScheduleError{Op: "staffing notice: group teams", Err: err}
	}
	staff, err := s.deps.Staff.FindWithPersonByIDs(ctx, staffingStaffIDs(stories, team))
	if err != nil {
		return &ports.ScheduleError{Op: "staffing notice: staff", Err: err}
	}
	reached := map[teamStoryKey]map[int64]bool{}
	for _, story := range stories {
		notice := s.staffingNotice(story, op, today, team.teachers, staff)
		markReached(reached, story, notice)
		if err := notifyStaffingStory(ctx, deps.Notices, notice); err != nil {
			return err
		}
	}
	return s.noticeTeams(ctx, op, today, team, staff, reached)
}

// notifyStaffingStory hands one story's notice to Delivery. Delivery updates
// unread entries with the same related object, so a notice without an object
// gets one of its own: a teacher affected by two changes in one save needs
// both entries and both push attempts.
func notifyStaffingStory(ctx context.Context, notices ports.StaffingNotices, notice ports.StaffingNotice) error {
	if notice.ObjectType == "" {
		notice.ObjectType, notice.ObjectID = staffingObjectStory, rand.Int64N(math.MaxInt64)+1
	}
	if len(notice.SubjectAccountIDs)+len(notice.SubstituteAccountIDs)+len(notice.TeacherAccountIDs)+len(notice.TeamAccountIDs) == 0 {
		return nil
	}
	if err := notices.NotifyStaffingChanged(ctx, notice); err != nil {
		return &ports.ScheduleError{Op: "staffing notice", Err: err}
	}
	return nil
}

// sortStaffingChanges orders the changes by day and start, so every story
// starts with its first block.
func sortStaffingChanges(changes []staffingChange) {
	slices.SortStableFunc(changes, func(a, b staffingChange) int {
		if c := a.date.Compare(b.date); c != 0 {
			return c
		}
		return a.start.Compare(b.start)
	})
}

// staffingStories groups the sorted changes by person and kind, in the
// order of their first block.
func staffingStories(changes []staffingChange) []staffingStory {
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

// staffingStaffIDs lists every person a notice names or reaches.
func staffingStaffIDs(stories []staffingStory, team blockTeam) []int64 {
	ids := map[int64]struct{}{}
	for _, story := range stories {
		ids[story.key.subjectID] = struct{}{}
		if story.key.substituteID > 0 {
			ids[story.key.substituteID] = struct{}{}
		}
	}
	for _, byBlock := range []map[int64][]int64{team.teachers, team.handovers} {
		for _, members := range byBlock {
			for _, id := range members {
				ids[id] = struct{}{}
			}
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
		Kind:        story.key.kind,
		SubjectName: staffName(staff[story.key.subjectID]), InstanceID: first.instanceID,
		Push: today.DaysUntil(first.date) <= staffNoticePushDays,
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
