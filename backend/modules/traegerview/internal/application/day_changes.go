package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ traegerview.DayChangesReport = (*Overview)(nil)

// SchoolsDayChanges returns "Heute anders" of the Träger-Portal (#7672): the
// schools of the Träger with a closing day or a cancelled block today. Every
// owner is read once for the whole school set, in the administrative unit,
// and only the Träger's schools are read. The answer names no person and no
// reason, so the read is not written to the access log (ADR 0084 section 7).
func (o *Overview) SchoolsDayChanges(ctx context.Context, organizationID int64) (traegerview.SchoolsDayChanges, error) {
	if organizationID <= 0 {
		return traegerview.SchoolsDayChanges{}, traegerview.ErrTraegerRequired
	}
	asOf := o.now()
	day := calendar.DateFromTime(asOf)
	result := traegerview.SchoolsDayChanges{Day: day, Schools: []traegerview.SchoolDayChanges{}, AsOf: asOf}
	err := o.read(ctx, organizationID, func(adminCtx context.Context, ids []int64) error {
		if len(ids) == 0 {
			return nil
		}
		closings, err := o.dayChanges.Closings.SchoolClosingDaysOn(adminCtx, organizationID, ids, day)
		if err != nil {
			return err
		}
		blocks, err := o.dayChanges.Blocks.CancelledBlocksByTenant(adminCtx, ids, day)
		if err != nil {
			return err
		}
		if len(closings) == 0 && len(blocks) == 0 {
			// No school has a change: the names are not needed.
			return nil
		}
		schools, err := o.rows.Schools(adminCtx, ids)
		if err != nil {
			return err
		}
		result.Schools = schoolsWithDayChanges(schools, closings, blocks, day)
		return nil
	})
	if err != nil {
		return traegerview.SchoolsDayChanges{}, err
	}
	return result, nil
}

// schoolsWithDayChanges keeps the schools, in their order by name, that
// have a closing day or a cancelled block on day.
func schoolsWithDayChanges(schools []traegerview.TraegerSchool, closings map[int64][]traegerview.SchoolClosingDay, blocks map[int64]int, day calendar.Date) []traegerview.SchoolDayChanges {
	result := []traegerview.SchoolDayChanges{}
	for _, school := range schools {
		id := school.ID.Int64()
		closed, cancelled := closings[id], blocks[id]
		if len(closed) == 0 && cancelled <= 0 {
			continue
		}
		changes := traegerview.SchoolDayChanges{TraegerSchool: school, ClosingDays: make([]traegerview.SchoolDayClosing, 0, len(closed)), CancelledBlocks: max(cancelled, 0)}
		for _, closing := range closed {
			changes.ClosingDays = append(changes.ClosingDays, dayClosing(closing, day))
		}
		result = append(result, changes)
	}
	return result
}

// dayClosing keeps "seit" and "bis" only where the closing reaches past the
// day.
func dayClosing(closing traegerview.SchoolClosingDay, day calendar.Date) traegerview.SchoolDayClosing {
	result := traegerview.SchoolDayClosing{Name: closing.Name, Traeger: closing.Traeger}
	if closing.StartDate.Before(day) {
		since := closing.StartDate
		result.Since = &since
	}
	if closing.EndDate.After(day) {
		until := closing.EndDate
		result.Until = &until
	}
	return result
}
