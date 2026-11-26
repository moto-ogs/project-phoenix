package api

// The opening changes of "Heute anders" (#8170). The Schule source of the
// child's day in the parents portal reads them from School Calendar beside
// the closing days and turns them into entries under the same rule. Reason
// is the name the school gives the day, never a reason of a person.

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesOpeningChangeReads is School Calendar's read of the opening
// changes of the school in the request's tenant transaction.
type dayChangesOpeningChangeReads interface {
	ListOpeningChanges(ctx context.Context, from, to calendar.Date) ([]schoolcalendar.OpeningChange, error)
}

// openingChangeEntries are the opening changes of day as entries; link and
// involved follow the closing days of the same source.
func openingChangeEntries(changes []schoolcalendar.OpeningChange, day calendar.Date, link *daychangesview.Link, involved bool) []daychangesview.SourceEntry {
	entries := make([]daychangesview.SourceEntry, 0, len(changes))
	for _, change := range changes {
		var since, until *calendar.Date
		if change.StartDate.Before(day) {
			first := change.StartDate
			since = &first
		}
		if change.EndDate.After(day) {
			last := change.EndDate
			until = &last
		}
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindOpeningChanged, Involved: involved, Since: since, Until: until, Link: link,
			Opening: &daychangesview.DayOpening{Name: change.Reason, OpensAt: change.OpensAt, ClosesAt: change.ClosesAt},
		})
	}
	return entries
}

// dayChangesWeeklyPickups is Care Plan's read of the stored weekly pickups
// (#8173).
type dayChangesWeeklyPickups interface {
	ListPickupSchedules(context.Context, careplan.StudentScheduleFilter) ([]careplan.PickupSchedule, error)
}

// markRegularPickupAfterClosing marks the opening changes of the child's day
// that close before the child's weekly pickup (#8173). It reads Care Plan
// only on a weekday with an opening change, in one statement: the stored
// weekly rows of the child for the weekday. Rows Care Plan derives from a
// booked care offering stay out; the latest stored time counts.
func markRegularPickupAfterClosing(ctx context.Context, pickups dayChangesWeeklyPickups, studentID int64, day calendar.Date, entries []daychangesview.SourceEntry) error {
	weekday := day.Weekday()
	if len(entries) == 0 || weekday == time.Saturday || weekday == time.Sunday {
		return nil
	}
	rows, err := pickups.ListPickupSchedules(ctx, careplan.StudentScheduleFilter{StudentIDs: []int64{studentID}, Weekday: int(weekday)})
	if err != nil {
		return fmt.Errorf("list weekly pickups: %w", err)
	}
	regular := ""
	for _, row := range rows {
		if row.StudentID != studentID || row.Weekday != int(weekday) || row.Source == careplan.ScheduleSourceCareOffering {
			continue
		}
		// The TIME column holds the wall clock itself; no zone applies.
		if at := row.PickupTime.Format("15:04"); at > regular {
			regular = at
		}
	}
	for i := range entries {
		if opening := entries[i].Opening; opening != nil && regular != "" && regular > opening.ClosesAt {
			at := regular
			opening.RegularPickupAfterClosing = &at
		}
	}
	return nil
}
