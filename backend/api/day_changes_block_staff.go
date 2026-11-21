package api

// The block part of the Personal source of "Heute anders" (#7675): a staff
// member who misses a single block of the day (terminbezogene Abwesenheit)
// and who covers a single block (Terminvertretung). Timetable owns the
// blocks and their staff rows; the Personal rule of this read lives here with
// the rest of it (ADR 0299, addenda #7659 and #7675): the care staff sees
// names for its own blocks and for its team, for the rest of the school the
// number with users:read, as for the absences; the lead sees every name.

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesBlockStaff is Timetable's read of the day's blocks with an
// absent or covering supervisor.
type dayChangesBlockStaff interface {
	BlockStaffChanges(ctx context.Context, date calendar.Date) ([]timetable.BlockStaffChange, error)
}

// addBlocks reads the day's block changes in one read and adds those the
// caller may see. An account without a staff record that is not the lead
// sees none, so it reads nothing. absentToday are the staff members with an
// absence of the day: their entry already says they are not there.
func (s dayChangesStaff) addBlocks(ctx context.Context, builder *staffEntryBuilder, day calendar.Date, absentToday map[int64]bool) error {
	if builder.viewer.selfID == 0 && !builder.viewer.lead {
		return nil
	}
	changes, err := s.sources.BlockStaff.BlockStaffChanges(ctx, day)
	if err != nil {
		return fmt.Errorf("list block staff changes: %w", err)
	}
	for _, change := range changes {
		builder.block(change, absentToday)
	}
	return nil
}

// blockStaff sorts a block's staff rows: who covers, whom they replace,
// and who misses the block alone. An absence that a sick report or an
// absence of the day set misses nothing of its own: the day's absence is the
// entry. Its cover still is.
type blockStaff struct {
	substitutes, replaced, missing []int64
	// own: the caller is on the block (eigener Termin).
	own bool
}

func sortBlockStaff(change timetable.BlockStaffChange, selfID int64, absentToday map[int64]bool) blockStaff {
	var staff blockStaff
	for _, row := range change.Staff {
		staff.own = staff.own || (selfID != 0 && row.StaffID == selfID)
		switch {
		case row.Substitute:
			staff.substitutes = append(staff.substitutes, row.StaffID)
		case row.Absent:
			staff.replaced = append(staff.replaced, row.StaffID)
			if !row.SickReport && !absentToday[row.StaffID] {
				staff.missing = append(staff.missing, row.StaffID)
			}
		}
	}
	return staff
}

// entry names the block's change: its cover or, without one, who misses
// it. ok is false for a block whose only absences are the day's.
func (staff blockStaff) entry(selfID int64) (kind daychangesview.Kind, people []daychangesview.Person, ok bool) {
	if len(staff.substitutes) > 0 {
		return daychangesview.KindBlockSubstitution, blockPeople(staff.substitutes, staff.replaced, selfID), true
	}
	if len(staff.missing) == 0 {
		return "", nil, false
	}
	people = blockPeople(nil, staff.missing, selfID)
	for i := range people {
		people[i].Role = daychangesview.RoleAbsent
	}
	return daychangesview.KindBlockStaffAbsent, people, true
}

// block adds one block's change if the Personal rule lets the caller see
// it: its own block, its team named on it, or the lead.
func (b *staffEntryBuilder) block(change timetable.BlockStaffChange, absentToday map[int64]bool) {
	staff := sortBlockStaff(change, b.viewer.selfID, absentToday)
	kind, people, ok := staff.entry(b.viewer.selfID)
	if !ok {
		return
	}
	involved := staff.own
	for _, person := range people {
		involved = involved || b.viewer.team[person.StaffID]
	}
	if !involved && !b.viewer.lead {
		if b.viewer.counts {
			b.blockCount++
		}
		return
	}
	for _, person := range people {
		b.staffIDs[person.StaffID] = true
	}
	entry := daychangesview.SourceEntry{
		Kind: kind, Involved: involved, People: people,
		Activity: &daychangesview.BlockActivity{ID: change.InstanceID, Title: change.Title},
		Link:     b.blockLink(change.InstanceID),
	}
	entry.StartsAt, entry.EndsAt = wallClockInstants(b.day, change.StartTime, change.EndTime)
	b.entries = append(b.entries, entry)
}

// blockPeople names the covers first, then the supervisors they replace.
func blockPeople(substitutes, replaced []int64, selfID int64) []daychangesview.Person {
	people := make([]daychangesview.Person, 0, len(substitutes)+len(replaced))
	for _, id := range substitutes {
		people = append(people, daychangesview.Person{StaffID: id, Role: daychangesview.RoleSubstitute, IsSelf: selfID != 0 && id == selfID})
	}
	for _, id := range replaced {
		people = append(people, daychangesview.Person{StaffID: id, Role: daychangesview.RoleReplaced, IsSelf: selfID != 0 && id == selfID})
	}
	return people
}

// blockLink opens the block in the Vertretungsplan for whoever plans covers
// (schedules:manage), otherwise the day plan for whoever reads it.
func (b *staffEntryBuilder) blockLink(instanceID int64) *daychangesview.Link {
	switch {
	case b.viewer.substitutionPlan:
		return &daychangesview.Link{Target: daychangesview.LinkSubstitutionPlan, InstanceID: &instanceID}
	case b.viewer.dayPlan:
		return &daychangesview.Link{Target: daychangesview.LinkDayPlan}
	default:
		return nil
	}
}

// wallClockInstants turns a wall clock of the day ("HH:MM") into instants in
// the school's time zone. An end that is not after the start ends with the
// day, as the lifecycle treats it.
func wallClockInstants(day calendar.Date, startClock, endClock string) (*time.Time, *time.Time) {
	start, err := time.ParseInLocation("2006-01-02 15:04", day.String()+" "+startClock, calendar.Berlin)
	if err != nil {
		return nil, nil
	}
	end, err := time.ParseInLocation("2006-01-02 15:04", day.String()+" "+endClock, calendar.Berlin)
	if err != nil || !end.After(start) {
		end = day.EndOfDay()
	}
	return &start, &end
}
