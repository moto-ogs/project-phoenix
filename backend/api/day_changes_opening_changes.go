package api

// The opening changes of "Heute anders" (#8170). The Schule source of the
// child's day in the parents portal reads them from School Calendar beside
// the closing days and turns them into entries under the same rule. Reason
// is the name the school gives the day, never a reason of a person.

import (
	"context"

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
