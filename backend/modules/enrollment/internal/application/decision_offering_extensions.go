package application

import (
	"context"
	"fmt"
	"maps"
	"slices"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// markExtendableBookings sets ChildOfferingRow.ExtendsUntil on each current
// booking the office can extend in an undated correction (#7929): its end
// lies before the end of the phase, no other booking of the child starts
// there (that would be a scheduled change, which the correction keeps), and
// the child's care runs on past it. The new last day is the end of the phase
// or the child's earlier care end. A row of automatic days only follows its
// trigger and is never marked. The care ends are read in one statement, and
// only when a row qualifies.
func (d *Decisions) markExtendableBookings(
	ctx context.Context,
	phase *enrollmentNative.Phase,
	children []*enrollmentNative.RequestChild,
	linksByChild map[int64][]*enrollmentNative.RequestChildOfferingRecord,
	sets map[int64]enrollmentNative.ChildOfferingSet,
) error {
	if d.deps.CareStudents == nil || phase == nil {
		return nil
	}
	phaseEnd := calendar.Date(phase.ServiceEndDate)
	studentByChild := childrenWithLimitedBookings(children, linksByChild, sets, phaseEnd)
	if len(studentByChild) == 0 {
		return nil
	}
	lastDays, err := d.lastCareDays(ctx, studentByChild, phaseEnd)
	if err != nil {
		return err
	}
	for childID, studentID := range studentByChild {
		lastDay, inCare := lastDays[studentID]
		if !inCare {
			continue
		}
		set := sets[childID]
		for i := range set.Current {
			end, limited := limitedBookingEnd(set.Current[i], linksByChild[childID], phaseEnd)
			if limited && end.Before(lastDay.AddDays(1)) {
				until := lastDay
				set.Current[i].ExtendsUntil = &until
			}
		}
	}
	return nil
}

// childrenWithLimitedBookings maps each approved child with a record and at
// least one limited current booking to its student.
func childrenWithLimitedBookings(
	children []*enrollmentNative.RequestChild,
	linksByChild map[int64][]*enrollmentNative.RequestChildOfferingRecord,
	sets map[int64]enrollmentNative.ChildOfferingSet,
	phaseEnd calendar.Date,
) map[int64]int64 {
	studentByChild := make(map[int64]int64)
	for _, child := range children {
		if child == nil || child.Status != enrollmentNative.ChildStatusApproved || child.CreatedStudentID == nil || *child.CreatedStudentID <= 0 {
			continue
		}
		if slices.ContainsFunc(sets[child.ID].Current, func(row enrollmentNative.ChildOfferingRow) bool {
			_, limited := limitedBookingEnd(row, linksByChild[child.ID], phaseEnd)
			return limited
		}) {
			studentByChild[child.ID] = *child.CreatedStudentID
		}
	}
	return studentByChild
}

// lastCareDays is the last day an extension books each student in care to:
// the end of the phase or the earlier care end. A student whose care ended
// is absent.
func (d *Decisions) lastCareDays(ctx context.Context, studentByChild map[int64]int64, phaseEnd calendar.Date) (map[int64]calendar.Date, error) {
	studentIDs := slices.Collect(maps.Values(studentByChild))
	students, err := d.deps.CareStudents.PhaseCareStudents(ctx, studentIDs)
	if err != nil {
		return nil, fmt.Errorf("decision: read care ends for booking extensions: %w", err)
	}
	lastDays := make(map[int64]calendar.Date, len(students))
	for _, student := range students {
		if !student.InCare {
			continue
		}
		lastDay := phaseEnd
		if !student.CareEnd.IsZero() && student.CareEnd.Before(lastDay) {
			lastDay = student.CareEnd
		}
		lastDays[student.ID] = lastDay
	}
	return lastDays, nil
}

// limitedBookingEnd is the exclusive end of row's booking, followed through
// the bookings of the same offering that continue it, when the care of this
// offering stops there before the phase ends; it mirrors the end an undated
// correction keeps in Care Plan.
func limitedBookingEnd(row enrollmentNative.ChildOfferingRow, links []*enrollmentNative.RequestChildOfferingRecord, phaseEnd calendar.Date) (calendar.Date, bool) {
	if row.ValidUntil == nil || (len(row.ManualSelectedDays) == 0 && len(row.AutomaticSelectedDays) > 0) {
		return "", false
	}
	end := *row.ValidUntil
	for {
		next := linkStartingOn(links, end, row.OfferingID)
		if next == nil {
			break
		}
		if next.ValidUntil == nil {
			return "", false
		}
		end = *next.ValidUntil
	}
	if linkStartingOn(links, end, 0) != nil || !end.Before(phaseEnd.AddDays(1)) {
		return "", false
	}
	return end, true
}

// linkStartingOn is the link that starts on day, of offering when it is set.
func linkStartingOn(links []*enrollmentNative.RequestChildOfferingRecord, day calendar.Date, offering int64) *enrollmentNative.RequestChildOfferingRecord {
	for _, link := range links {
		if link != nil && link.ValidFrom != nil && *link.ValidFrom == day && (offering == 0 || link.CareOfferingID == offering) {
			return link
		}
	}
	return nil
}
