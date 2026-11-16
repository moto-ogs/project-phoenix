package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Team notices (#7138): when a colleague is not there, the team of the
// affected OGS groups hears about it. The team of a group on a day is who
// "my groups" names: the teachers assigned to it and whoever holds it by a
// Gruppenübergabe that day. Whoever already hears about the same person in
// the same operation (#7136) gets no second entry, and neither the person
// nor the one who made the change hears it as the team. One absence is one
// notice per operation, whatever the number of days, and it never names a
// reason.

// blockTeam names, per block, the staff ids of its groups' team: the
// assigned teachers and the handovers covering the block's day.
type blockTeam struct {
	teachers  map[int64][]int64
	handovers map[int64][]int64
}

// members lists the team of one block, teachers first.
func (t blockTeam) members(instanceID int64) []int64 {
	return append(slices.Clone(t.teachers[instanceID]), t.handovers[instanceID]...)
}

// blockTeams reads the groups of the changed blocks, their teachers and
// their handovers over the operation's days, three batched reads.
func (s *staffDeviations) blockTeams(ctx context.Context, changes []staffingChange) (blockTeam, error) {
	deps := s.deps.StaffingNotices
	team := blockTeam{teachers: map[int64][]int64{}, handovers: map[int64][]int64{}}
	instanceIDs, dayOf := changedBlocks(changes)
	groupsByBlock, err := deps.Groups.BlockEducationGroups(ctx, instanceIDs)
	if err != nil {
		return team, err
	}
	groupIDs := distinctGroups(groupsByBlock)
	if len(groupIDs) == 0 {
		return team, nil
	}
	teachersByGroup, err := deps.Teachers.GroupTeacherStaffIDs(ctx, groupIDs)
	if err != nil {
		return team, err
	}
	// changes are sorted: the first and the last change bound the days.
	handovers, err := deps.Handovers.GroupHandovers(ctx, groupIDs, changes[0].date, changes[len(changes)-1].date)
	if err != nil {
		return team, err
	}
	for instanceID, groups := range groupsByBlock {
		for _, groupID := range groups {
			team.teachers[instanceID] = append(team.teachers[instanceID], teachersByGroup[groupID]...)
			team.handovers[instanceID] = append(team.handovers[instanceID], handoverStaff(handovers, groupID, dayOf[instanceID])...)
		}
	}
	return team, nil
}

// changedBlocks lists each changed block once with its day.
func changedBlocks(changes []staffingChange) ([]int64, map[int64]calendar.Date) {
	dayOf := make(map[int64]calendar.Date, len(changes))
	instanceIDs := make([]int64, 0, len(changes))
	for _, change := range changes {
		if _, ok := dayOf[change.instanceID]; !ok {
			dayOf[change.instanceID] = change.date
			instanceIDs = append(instanceIDs, change.instanceID)
		}
	}
	return instanceIDs, dayOf
}

func distinctGroups(groupsByBlock map[int64][]int64) []int64 {
	var groupIDs []int64
	for _, groups := range groupsByBlock {
		for _, groupID := range groups {
			if !slices.Contains(groupIDs, groupID) {
				groupIDs = append(groupIDs, groupID)
			}
		}
	}
	slices.Sort(groupIDs)
	return groupIDs
}

// handoverStaff lists who holds the group by a handover on the day.
func handoverStaff(handovers []ports.GroupHandover, groupID int64, day calendar.Date) []int64 {
	var staffIDs []int64
	for _, handover := range handovers {
		if handover.GroupID == groupID && !day.Before(handover.From) && !day.After(handover.To) {
			staffIDs = append(staffIDs, handover.StaffID)
		}
	}
	return staffIDs
}

// markReached records the accounts a story's notice reaches, per person the
// story is about.
func markReached(reached map[int64]map[int64]bool, subjectID int64, notice ports.StaffingNotice) {
	if reached[subjectID] == nil {
		reached[subjectID] = map[int64]bool{}
	}
	for _, accounts := range [][]int64{notice.SubjectAccountIDs, notice.SubstituteAccountIDs, notice.TeacherAccountIDs} {
		for _, accountID := range accounts {
			reached[subjectID][accountID] = true
		}
	}
}

// teamStoryKey is one person's absence (back false) or return in an
// operation. Uncovered and substituted blocks are the same absence to the
// team.
type teamStoryKey struct {
	subjectID int64
	back      bool
}

type teamStory struct {
	key     teamStoryKey
	changes []staffingChange
}

// teamStories groups the sorted changes into absences and returns, in the
// order of their first block. A removed substitute is no absence.
func teamStories(changes []staffingChange) []teamStory {
	index := map[teamStoryKey]int{}
	var stories []teamStory
	for _, change := range changes {
		var key teamStoryKey
		switch change.kind {
		case ports.StaffingChangeAbsent, ports.StaffingChangeSubstituted:
			key = teamStoryKey{subjectID: change.subjectID}
		case ports.StaffingChangePresent:
			key = teamStoryKey{subjectID: change.subjectID, back: true}
		default:
			continue
		}
		i, ok := index[key]
		if !ok {
			i = len(stories)
			index[key] = i
			stories = append(stories, teamStory{key: key})
		}
		stories[i].changes = append(stories[i].changes, change)
	}
	return stories
}

// noticeTeams tells the rest of the team about every absence and return of
// the operation.
func (s *staffDeviations) noticeTeams(ctx context.Context, op staffingOperation, today calendar.Date, team blockTeam, staff map[int64]*timetable.StaffMember, reached map[int64]map[int64]bool) error {
	for _, story := range teamStories(op.changes) {
		notice := teamNotice(story, op, today, team, staff, reached[story.key.subjectID])
		if len(notice.TeamAccountIDs) == 0 {
			continue
		}
		if err := notifyStaffingStory(ctx, s.deps.StaffingNotices.Notices, notice); err != nil {
			return err
		}
	}
	return nil
}

// teamNotice builds the notice of one absence or return for the team,
// without the person, the actor and whoever already heard about the person
// in this operation.
func teamNotice(story teamStory, op staffingOperation, today calendar.Date, team blockTeam, staff map[int64]*timetable.StaffMember, reached map[int64]bool) ports.StaffingNotice {
	first := story.changes[0]
	notice := ports.StaffingNotice{
		Kind: ports.StaffingChangeAbsent, SubjectName: staffName(staff[story.key.subjectID]), InstanceID: first.instanceID,
		Push: today.DaysUntil(first.date) <= staffNoticePushDays,
	}
	if story.key.back {
		notice.Kind = ports.StaffingChangePresent
	}
	seen := map[int64]bool{staffAccount(staff[story.key.subjectID]): true, 0: true}
	if op.actor != nil {
		seen[*op.actor] = true
	}
	for accountID := range reached {
		seen[accountID] = true
	}
	for _, change := range story.changes {
		if !slices.Contains(notice.Days, change.date) {
			notice.Days = append(notice.Days, change.date)
		}
		for _, staffID := range team.members(change.instanceID) {
			if accountID := staffAccount(staff[staffID]); !seen[accountID] {
				seen[accountID] = true
				notice.TeamAccountIDs = append(notice.TeamAccountIDs, accountID)
			}
		}
	}
	return notice
}
