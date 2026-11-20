package api

// The Dienstplan part of the Personal source of "Heute anders" (#7661):
// the shifts of the day that run differently, do not take place or cover a
// cancelled one. Workforce owns the shifts; the rule of this read lives here
// with the rest of the Personal rule (ADR 0299, addendum #7659).

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// addShifts reads the day's shifts the caller may see in one read: every
// shift for the lead of the Dienstplan, the caller's own otherwise. An
// account without a staff record and without the Dienstplan reads nothing.
func (s dayChangesStaff) addShifts(ctx context.Context, builder *staffEntryBuilder, day calendar.Date) error {
	filter := workforce.StaffShiftFilter{From: day.String(), To: day.String()}
	switch {
	case builder.viewer.shiftPlan:
	case builder.viewer.selfID != 0:
		filter.StaffID = builder.viewer.selfID
	default:
		return nil
	}
	shifts, err := s.sources.Workforce.ListStaffShifts(ctx, filter)
	if err != nil {
		return fmt.Errorf("list staff shifts: %w", err)
	}
	origins := make(map[int64]workforce.StaffShift, len(shifts))
	for _, shift := range shifts {
		origins[shift.ID] = shift
	}
	for _, shift := range shifts {
		builder.shift(shift, origins)
	}
	return nil
}

// shift adds one shift that is a change to regular operation. It never
// carries the change reason; the reason only tells a cancellation the
// absence cascade wrote, which the absence entry already names.
func (b *staffEntryBuilder) shift(shift workforce.StaffShift, origins map[int64]workforce.StaffShift) {
	kind, ok := shiftChangeKind(shift)
	if !ok {
		return
	}
	self := shift.StaffID == b.viewer.selfID
	if !self && !b.viewer.shiftPlan {
		return
	}
	people := []daychangesview.Person{{StaffID: shift.StaffID, Role: daychangesview.RoleOnDuty, IsSelf: self}}
	if kind == daychangesview.KindShiftReplacement {
		people[0].Role = daychangesview.RoleSubstitute
		// The covered shift is in the read only for the lead: the care staff
		// sees its own shifts, not whom it covers.
		if origin, found := origins[*shift.OriginShiftID]; found {
			people = append(people, daychangesview.Person{StaffID: origin.StaffID, Role: daychangesview.RoleReplaced, IsSelf: origin.StaffID == b.viewer.selfID})
		}
	}
	involved := false
	for _, person := range people {
		b.staffIDs[person.StaffID] = true
		involved = involved || person.IsSelf
	}
	startsAt, endsAt := shiftInstants(shift)
	b.entries = append(b.entries, daychangesview.SourceEntry{
		Kind: kind, Involved: involved,
		StartsAt: startsAt, EndsAt: endsAt, People: people,
		Link: b.shiftLink(shift.StaffID, self),
	})
}

// shiftChangeKind decides whether a shift is a change of the day. A shift
// the plan cancelled for an absence is not: the absence is the entry. A
// standalone shift is the plan itself; only a series occurrence edited for
// this day or moved to it runs differently than usual.
func shiftChangeKind(shift workforce.StaffShift) (daychangesview.Kind, bool) {
	switch {
	case shift.Cancelled:
		if shift.SickAbsenceID != nil || (shift.ChangeReason != nil && workforce.IsAbsenceShiftChangeReason(*shift.ChangeReason)) {
			return "", false
		}
		return daychangesview.KindShiftCancelled, true
	case shift.OriginShiftID != nil:
		return daychangesview.KindShiftReplacement, true
	case shift.SeriesID != nil && (shift.Detached || shift.SeriesOverride ||
		(shift.SeriesOccurrenceDate != "" && shift.SeriesOccurrenceDate != shift.Date)):
		return daychangesview.KindShiftChanged, true
	default:
		return "", false
	}
}

func (b *staffEntryBuilder) shiftLink(staffID int64, self bool) *daychangesview.Link {
	switch {
	case self && b.viewer.ownAbsences:
		// time_tracking:own opens the own Dienstplan as well.
		return &daychangesview.Link{Target: daychangesview.LinkOwnShiftPlan}
	case self:
		return nil
	default:
		return &daychangesview.Link{Target: daychangesview.LinkShiftPlan, StaffID: &staffID}
	}
}

// shiftInstants turns the stored day and wall clocks into instants of the
// school's time zone. A clock that does not parse leaves the entry without
// a time rather than failing the source.
func shiftInstants(shift workforce.StaffShift) (startsAt, endsAt *time.Time) {
	start, startErr := time.ParseInLocation(workforce.DateLayout+" "+workforce.ClockLayout, shift.Date+" "+shift.StartTime, calendar.Berlin)
	end, endErr := time.ParseInLocation(workforce.DateLayout+" "+workforce.ClockLayout, shift.Date+" "+shift.EndTime, calendar.Berlin)
	if startErr != nil || endErr != nil {
		return nil, nil
	}
	return &start, &end
}
