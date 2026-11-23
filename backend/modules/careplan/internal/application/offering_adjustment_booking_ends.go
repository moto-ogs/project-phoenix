package application

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// keepBookingEnds gives an offering that stays chosen the end its booking
// has (#7909, #7928): a change books what the office or the family changed,
// and an offering booked until February is not booked to the end of the
// phase because a weekday changed, with or without a date. The end is the
// last day of the offering's stored bookings that follow each other from the
// one in effect. An end on which another stored booking of the child starts
// is not the end of the care but the start of a scheduled change: an undated
// correction schedules it again, and it closes the booking there; a change
// with a date replaces it, and the booking runs on as the change books it.
// The offering is then booked as a new one. An offering the change adds is
// booked as before. The care end of the child record, set on the rows
// already, still wins when it is earlier. The capacity check of a change
// reads the same ends (selectionBookingEnds).
//
// A row of automatic days only (a co-booking or the required lunch) ends
// with the last of the rows that add its days (coBookingEnds), and keeps its
// own end only when no row of the selection adds one.
func keepBookingEnds(replacement, before, stored []*careplan.BookedOffering, offerings map[int64]*careplan.CareOffering, phaseEnd calendar.Date) {
	ends := storedBookingEnds(before, stored, phaseEnd)
	for _, row := range replacement {
		if end, ok := ends[row.CareOfferingID]; ok && !automaticOnly(row) {
			endAtMost(row, end)
		}
	}
	coBooked := coBookingEnds(replacement, offerings)
	for _, row := range replacement {
		if !automaticOnly(row) {
			continue
		}
		if end, derived := coBooked[row]; derived {
			if end != nil {
				endAtMost(row, *end)
			}
		} else if end, ok := ends[row.CareOfferingID]; ok {
			endAtMost(row, end)
		}
	}
}

// selectionBookingEnds is the exclusive end a change books each offering of
// the materialized selection to, before the care end of the child record:
// the end keepBookingEnds keeps, or the end of the phase. The capacity check
// of a change reserves this window, so it checks what the change writes.
func selectionBookingEnds(selections []careplan.OfferingSelection, before, stored []*careplan.BookedOffering,
	offerings map[int64]*careplan.CareOffering, phaseEnd calendar.Date) map[int64]calendar.Date {
	rows := make([]*careplan.BookedOffering, 0, len(selections))
	for _, selected := range selections {
		rows = append(rows, &careplan.BookedOffering{CareOfferingID: selected.OfferingID, SelectedDays: selected.SelectedDays,
			ManualSelectedDays: selected.ManualSelectedDays, AutomaticSelectedDays: selected.AutomaticSelectedDays})
	}
	keepBookingEnds(rows, before, stored, offerings, phaseEnd)
	ends := make(map[int64]calendar.Date, len(rows))
	for _, row := range rows {
		ends[row.CareOfferingID] = phaseEnd
		if row.ValidUntil != nil {
			ends[row.CareOfferingID] = *row.ValidUntil
		}
	}
	return ends
}

// endsBeforePhase reports whether a booking in effect ends before the
// phase does. Only then can a change keep an end, so only then does it read
// the stored bookings that follow it (keepBookingEnds).
func endsBeforePhase(before []*careplan.BookedOffering, phaseEnd calendar.Date) bool {
	for _, link := range before {
		if link != nil && link.ValidUntil != nil && link.ValidUntil.Before(phaseEnd) {
			return true
		}
	}
	return false
}

// storedBookingEnds is the end of each booking in effect that ends before
// the phase does.
func storedBookingEnds(before, stored []*careplan.BookedOffering, phaseEnd calendar.Date) map[int64]calendar.Date {
	ends := make(map[int64]calendar.Date, len(before))
	for _, link := range before {
		if end, ok := bookingEnd(link, stored); ok && end.Before(phaseEnd) {
			ends[link.CareOfferingID] = end
		}
	}
	return ends
}

func automaticOnly(row *careplan.BookedOffering) bool {
	return len(row.ManualSelectedDays) == 0 && len(row.AutomaticSelectedDays) > 0
}

// coBookingEnds is the end of each row of automatic days only: the latest
// end of the rows that add one of its days, by the rules of the selection
// engine (a trigger's days, or the care days of a required lunch). A nil
// end is open. The ends grow from none, so co-bookings that only add each
// other's days hold nothing; a row nothing adds a day to is left out.
func coBookingEnds(replacement []*careplan.BookedOffering, offerings map[int64]*careplan.CareOffering) map[*careplan.BookedOffering]*calendar.Date {
	sources := make(map[*careplan.BookedOffering][]*careplan.BookedOffering)
	for _, row := range replacement {
		if automaticOnly(row) {
			sources[row] = addingRows(row, replacement, offerings)
		}
	}
	ends := make(map[*careplan.BookedOffering]*calendar.Date, len(sources))
	for range len(sources) + 1 {
		for _, row := range replacement {
			if from, ok := sources[row]; ok {
				if end, covered := latestEnd(from, sources, ends); covered {
					ends[row] = end
				}
			}
		}
	}
	return ends
}

// addingRows are the rows of the selection that add one of row's days.
func addingRows(row *careplan.BookedOffering, rows []*careplan.BookedOffering, offerings map[int64]*careplan.CareOffering) []*careplan.BookedOffering {
	target := offerings[row.CareOfferingID]
	if target == nil {
		return nil
	}
	lunch := target.IsRequired && target.IncludesLunch && target.DaysOfWeekMode == daysOfWeekModeParentChoice
	var result []*careplan.BookedOffering
	for _, other := range rows {
		source := offerings[other.CareOfferingID]
		if other == row || source == nil {
			continue
		}
		adds := slices.Contains(target.AutoAddTriggerOfferingIDs, other.CareOfferingID) || (lunch && source.CountsAsCare)
		if adds && daysOverlap(contributedDays(source, other), target.AvailableDays) {
			result = append(result, other)
		}
	}
	return result
}

// contributedDays are the days a selected offering passes on to a rule.
func contributedDays(offering *careplan.CareOffering, row *careplan.BookedOffering) []string {
	if offering.DaysOfWeekMode == daysOfWeekModeFixed {
		return offering.AvailableDays
	}
	return row.SelectedDays
}

func daysOverlap(days, available []string) bool {
	for _, day := range days {
		if slices.Contains(available, day) {
			return true
		}
	}
	return false
}

// latestEnd is the last end of the rows that cover any day yet: a row of
// its own days by its end, a co-booking by the end found so far. Open wins.
func latestEnd(rows []*careplan.BookedOffering, sources map[*careplan.BookedOffering][]*careplan.BookedOffering,
	found map[*careplan.BookedOffering]*calendar.Date) (*calendar.Date, bool) {
	var latest *calendar.Date
	covered := false
	for _, row := range rows {
		end, ok := row.ValidUntil, true
		if _, derived := sources[row]; derived {
			end, ok = found[row]
		}
		if !ok {
			continue
		}
		if end == nil {
			return nil, true
		}
		if !covered || end.After(*latest) {
			latest = end
		}
		covered = true
	}
	return latest, covered
}

func endAtMost(row *careplan.BookedOffering, end calendar.Date) {
	if row.ValidUntil == nil || end.Before(*row.ValidUntil) {
		row.ValidUntil = &end
	}
}

// bookingEnd follows the offering's stored bookings from link to the last
// one that continues it and reports where that one ends, unless the care
// goes on there with another booking of the child.
func bookingEnd(link *careplan.BookedOffering, stored []*careplan.BookedOffering) (calendar.Date, bool) {
	if link == nil || link.ValidUntil == nil {
		return "", false
	}
	end := *link.ValidUntil
	for {
		next := startingOn(stored, end, func(row *careplan.BookedOffering) bool { return row.CareOfferingID == link.CareOfferingID })
		if next == nil {
			break
		}
		if next.ValidUntil == nil {
			return "", false
		}
		end = *next.ValidUntil
	}
	if startingOn(stored, end, func(*careplan.BookedOffering) bool { return true }) != nil {
		return "", false
	}
	return end, true
}

func startingOn(rows []*careplan.BookedOffering, day calendar.Date, match func(*careplan.BookedOffering) bool) *careplan.BookedOffering {
	for _, row := range rows {
		if row != nil && row.ValidFrom != nil && *row.ValidFrom == day && match(row) {
			return row
		}
	}
	return nil
}
