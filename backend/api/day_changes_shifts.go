package api

// The Dienstplan part of the Personal source of "Heute anders" (#7661): the
// shifts of the day that run at another time, do not take place, moved away
// or cover a cancelled one. Workforce owns the shifts; the rule of this read
// lives here with the rest of the Personal rule (ADR 0299, addenda #7659 and
// #7661).

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// dayShifts are the shifts relevant to the day, indexed for the rule.
type dayShifts struct {
	day  calendar.Date
	byID map[int64]workforce.StaffShift
}

// addShifts reads the day's shifts and series occurrences moved away from it
// in one read. The care staff sees its own shifts and the cover of a cancelled
// own shift; the lead of the Dienstplan sees every one. An account without a
// staff record and without the Dienstplan reads nothing.
func (s dayChangesStaff) addShifts(ctx context.Context, builder *staffEntryBuilder, day calendar.Date) error {
	if !builder.viewer.shiftPlan && builder.viewer.selfID == 0 {
		return nil
	}
	shifts, err := s.sources.Workforce.ListStaffShifts(ctx, workforce.StaffShiftFilter{
		From: day.String(), To: day.String(),
		IncludeSeriesOccurrenceDate: day.String(),
	})
	if err != nil {
		return fmt.Errorf("list staff shifts: %w", err)
	}
	window := indexShifts(day, shifts)
	for _, shift := range shifts {
		builder.shift(shift, window)
	}
	return nil
}

func indexShifts(day calendar.Date, shifts []workforce.StaffShift) dayShifts {
	window := dayShifts{day: day, byID: map[int64]workforce.StaffShift{}}
	for _, shift := range shifts {
		window.byID[shift.ID] = shift
	}
	return window
}

// shift adds one shift that is a change of the day. It never carries the
// change reason.
func (b *staffEntryBuilder) shift(shift workforce.StaffShift, window dayShifts) {
	kind, timed, ok := window.changeKind(shift)
	if !ok {
		return
	}
	people := []daychangesview.Person{{StaffID: ident.ID(shift.StaffID), Role: daychangesview.RoleOnDuty}}
	if kind == daychangesview.KindShiftReplacement {
		people[0].Role = daychangesview.RoleSubstitute
		if origin, found := window.byID[*shift.OriginShiftID]; found {
			people = append(people, daychangesview.Person{StaffID: ident.ID(origin.StaffID), Role: daychangesview.RoleReplaced})
		}
	}
	involved := false
	for i := range people {
		people[i].IsSelf = b.viewer.selfID != 0 && people[i].StaffID.Int64() == b.viewer.selfID
		involved = involved || people[i].IsSelf
	}
	if !involved && !b.viewer.shiftPlan {
		return
	}
	for _, person := range people {
		b.staffIDs[person.StaffID.Int64()] = true
	}
	entry := daychangesview.SourceEntry{
		Kind: kind, Involved: involved, People: people,
		Link: b.shiftLink(shift.StaffID, shift.StaffID == b.viewer.selfID),
	}
	if timed {
		entry.StartsAt, entry.EndsAt = shiftInstants(shift)
	}
	b.entries = append(b.entries, entry)
}

// changeKind decides whether a shift changes the day and whether its time
// belongs to the entry:
//   - cancelled today; not when an absence cancelled it, the absence is the
//     entry then (the cascade stamps the absence on the shift; older rows
//     carry its neutral reason instead);
//   - a series occurrence of today moved to another day: cancelled today,
//     without a time;
//   - a replacement covering a cancelled shift;
//   - a series occurrence moved to today, or edited to other times than the
//     series. An edit of the note or a withdrawn sick report detaches the
//     occurrence too, but leaves its times; that is no change.
//
// A standalone shift is the plan itself.
func (w dayShifts) changeKind(shift workforce.StaffShift) (daychangesview.Kind, bool, bool) {
	day := w.day.String()
	if shift.Date != day {
		if shift.SeriesOccurrenceDate == day && !absenceCancelled(shift) {
			return daychangesview.KindShiftCancelled, false, true
		}
		return "", false, false
	}
	switch {
	case shift.Cancelled:
		return daychangesview.KindShiftCancelled, true, !absenceCancelled(shift)
	case shift.OriginShiftID != nil:
		return daychangesview.KindShiftReplacement, true, true
	case shift.SeriesID == nil:
		return "", false, false
	case movedShift(shift):
		return daychangesview.KindShiftChanged, true, true
	case shift.Detached || shift.SeriesOverride:
		changed := shift.SeriesStartTime != "" && shift.SeriesEndTime != "" &&
			(shift.SeriesStartTime != shift.StartTime || shift.SeriesEndTime != shift.EndTime)
		return daychangesview.KindShiftChanged, true, changed
	default:
		return "", false, false
	}
}

func absenceCancelled(shift workforce.StaffShift) bool {
	return shift.SickAbsenceID != nil ||
		(shift.ChangeReason != nil && workforce.IsAbsenceShiftChangeReason(*shift.ChangeReason))
}

// movedShift reports a series occurrence that lies on another day than its
// recurrence slot.
func movedShift(shift workforce.StaffShift) bool {
	return shift.SeriesOccurrenceDate != "" && shift.SeriesOccurrenceDate != shift.Date
}

func (b *staffEntryBuilder) shiftLink(staffID int64, self bool) *daychangesview.Link {
	switch {
	case self && b.viewer.ownAbsences:
		// time_tracking:own opens the own time tracking and the own Dienstplan.
		return &daychangesview.Link{Target: daychangesview.LinkOwnShiftPlan}
	case b.viewer.shiftPlan:
		return &daychangesview.Link{Target: daychangesview.LinkShiftPlan, StaffID: (*ident.ID)(&staffID)}
	default:
		return nil
	}
}

// shiftInstants turns the stored day and wall clocks into instants of the
// school's time zone. A clock that does not parse leaves the entry without
// a time rather than failing the source.
func shiftInstants(shift workforce.StaffShift) (startsAt, endsAt *time.Time) {
	layout := workforce.DateLayout + " " + workforce.ClockLayout
	start, startErr := time.ParseInLocation(layout, shift.Date+" "+shift.StartTime, calendar.Berlin)
	end, endErr := time.ParseInLocation(layout, shift.Date+" "+shift.EndTime, calendar.Berlin)
	if startErr != nil || endErr != nil {
		return nil, nil
	}
	return &start, &end
}
