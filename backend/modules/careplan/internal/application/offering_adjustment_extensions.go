package application

import (
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The office extends a limited booking to the end of the phase in an
// undated correction (#7929, careplan.OfferingAdjustmentChoice.
// ExtendToPhaseEnd). The correction books such an offering like a new one:
// to the end of the phase or to the earlier care end of the child record
// (capOfferingReplacementAtCareEnd), and the co-bookings it adds go on with
// it.

// extendedOfferings are the offerings the office extends to the end of the
// phase.
func extendedOfferings(choices []careplan.OfferingAdjustmentChoice) map[int64]bool {
	var extended map[int64]bool
	for _, choice := range choices {
		if choice.ExtendToPhaseEnd {
			if extended == nil {
				extended = make(map[int64]bool)
			}
			extended[choice.OfferingID] = true
		}
	}
	return extended
}

// keepUnextendedBookingEnds keeps the ends of the bookings the office does
// not extend (keepBookingEnds) and answers the stored ends it found, the
// extended ones included, for the history. A change scheduled after the end
// is restored afterwards and starts where it is planned; it bounds the
// extension (nextScheduledChange).
func keepUnextendedBookingEnds(work *offeringAdjustmentWork, history []*careplan.BookedOffering) map[int64]calendar.Date {
	phaseEnd := work.phase.ServiceEnd.AddDays(1)
	extended := extendedOfferings(work.input.Offerings)
	kept := work.beforeLinks[:0:0]
	for _, link := range work.beforeLinks {
		if link == nil || !extended[link.CareOfferingID] {
			kept = append(kept, link)
		}
	}
	keepBookingEnds(work.replacement, kept, history, work.offeringByID, phaseEnd)
	if scheduled := scheduledOfferingReplacements(history, work.selectionDate); len(scheduled) > 0 {
		next := scheduled[0].EffectiveFrom
		work.nextScheduledChange = &next
	}
	return storedBookingEnds(work.beforeLinks, history, phaseEnd)
}

// recordExtendedEnds names in the after snapshot the new last day of each
// extended offering whose end moved, so the history does not read as
// unchanged.
func recordExtendedEnds(work *offeringAdjustmentWork) error {
	extended := extendedOfferings(work.input.Offerings)
	until := make(map[int64]calendar.Date)
	for _, row := range work.replacement {
		end, limited := work.keptEnds[row.CareOfferingID]
		if !extended[row.CareOfferingID] || !limited || row.ValidUntil == nil {
			continue
		}
		written := *row.ValidUntil
		if next := work.nextScheduledChange; next != nil && next.Before(written) {
			written = *next
		}
		if written.After(end) {
			until[row.CareOfferingID] = written.AddDays(-1)
		}
	}
	if len(until) == 0 {
		return nil
	}
	afterJSON, err := adjustmentSnapshotJSON(work.replacement, work.offeringByID, until)
	if err != nil {
		return err
	}
	work.afterJSON = afterJSON
	return nil
}
