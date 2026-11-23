package application

import (
	"context"
	"fmt"
	"log/slog"
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
// trigger and is never marked. A change scheduled after the end bounds the
// extension: the correction keeps it and it starts where it is planned, so
// the new last day is the day before. The care ends are read once per
// request, and only when a row qualifies; a failed read offers nothing.
func (d *Decisions) markExtendableBookings(
	ctx context.Context,
	phase *enrollmentNative.Phase,
	selectionDate calendar.Date,
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
	lastDays, err := d.optionalLastCareDays(ctx, studentByChild, phaseEnd)
	if err != nil {
		return err
	}
	for childID, studentID := range studentByChild {
		lastDay, inCare := lastDays[studentID]
		if !inCare {
			continue
		}
		if next, scheduled := nextScheduledChange(linksByChild[childID], selectionDate); scheduled && next.Before(lastDay.AddDays(1)) {
			lastDay = next.AddDays(-1)
		}
		markExtendableRows(sets[childID].Current, linksByChild[childID], phaseEnd, lastDay)
	}
	return nil
}

// markExtendableRows offers lastDay on each limited row that ends before it.
func markExtendableRows(rows []enrollmentNative.ChildOfferingRow, links []*enrollmentNative.RequestChildOfferingRecord, phaseEnd, lastDay calendar.Date) {
	for i := range rows {
		end, limited := limitedBookingEnd(rows[i], links, phaseEnd)
		if limited && end.Before(lastDay.AddDays(1)) {
			until := lastDay
			rows[i].ExtendsUntil = &until
		}
	}
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

// optionalLastCareDays reads lastCareDays in a savepoint of the ambient
// transaction: a failed read offers no extension and leaves the transaction
// usable for the rest of the detail. Only a failed savepoint is an error.
func (d *Decisions) optionalLastCareDays(ctx context.Context, studentByChild map[int64]int64, phaseEnd calendar.Date) (map[int64]calendar.Date, error) {
	var lastDays map[int64]calendar.Date
	read := func(readCtx context.Context) error {
		var err error
		lastDays, err = d.lastCareDays(readCtx, studentByChild, phaseEnd)
		return err
	}
	var err error
	if d.deps.Runtime.InTransaction != nil && d.deps.Runtime.Savepoint != nil && d.deps.Runtime.InTransaction(ctx) {
		err = d.deps.Runtime.Savepoint(ctx, read)
	} else {
		err = read(ctx)
	}
	if err == nil {
		return lastDays, nil
	}
	if d.deps.Runtime.IsSavepointControl != nil && d.deps.Runtime.IsSavepointControl(err) {
		return nil, err
	}
	d.logger().Warn("decision: care ends for booking extensions unavailable, offering none",
		slog.String("error", err.Error()))
	return nil, nil
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

// nextScheduledChange is the first day after selectionDate on which a stored
// booking of the child starts: the change an undated correction schedules
// again (scheduledOfferingReplacements in Care Plan).
func nextScheduledChange(links []*enrollmentNative.RequestChildOfferingRecord, selectionDate calendar.Date) (calendar.Date, bool) {
	var next calendar.Date
	for _, link := range links {
		if link != nil && link.ValidFrom != nil && link.ValidFrom.After(selectionDate) && (next.IsZero() || link.ValidFrom.Before(next)) {
			next = *link.ValidFrom
		}
	}
	return next, !next.IsZero()
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
