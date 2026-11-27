package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ traegerview.DayChangesReport = (*Overview)(nil)

// dayChangeSources are the owners' answers of "Heute anders" for the school
// set, keyed by school.
type dayChangeSources struct {
	days   map[int64]traegerview.SchoolCalendarDay
	blocks map[int64]int
	meals  map[int64]bool
	rooms  map[int64]int
}

// SchoolsDayChanges returns "Heute anders" of the Träger-Portal (#7672,
// #8146): the schools of the Träger with a closing day, changed opening
// hours, a cancelled block, a cancelled lunch or a closed room today.
// Organisation & Tenancy reads the Träger's schools with their names in one
// statement; every other owner is read once for the whole school set, in the
// administrative unit, and only the Träger's schools are read. The answer
// names no person and no reason, so the read is not written to the access
// log (ADR 0084 section 7).
func (o *Overview) SchoolsDayChanges(ctx context.Context, organizationID int64) (traegerview.SchoolsDayChanges, error) {
	if organizationID <= 0 {
		return traegerview.SchoolsDayChanges{}, traegerview.ErrTraegerRequired
	}
	asOf := o.now()
	day := calendar.DateFromTime(asOf)
	result := traegerview.SchoolsDayChanges{Day: day, Schools: []traegerview.SchoolDayChanges{}, AsOf: asOf}
	err := o.read(ctx, organizationID, nil, func(adminCtx context.Context, schools []traegerview.TraegerSchool) error {
		if len(schools) == 0 {
			return nil
		}
		ids := make([]int64, 0, len(schools))
		for _, school := range schools {
			ids = append(ids, school.ID.Int64())
		}
		sources, err := o.readDayChangeSources(adminCtx, organizationID, ids, day)
		if err != nil {
			return err
		}
		result.Schools = schoolsWithDayChanges(schools, sources, day)
		return nil
	})
	if err != nil {
		return traegerview.SchoolsDayChanges{}, err
	}
	return result, nil
}

// readDayChangeSources reads each owner once for the school set.
func (o *Overview) readDayChangeSources(ctx context.Context, organizationID int64, ids []int64, day calendar.Date) (dayChangeSources, error) {
	var sources dayChangeSources
	var err error
	if sources.days, err = o.dayChanges.Days.SchoolCalendarDaysOn(ctx, organizationID, ids, day); err != nil {
		return sources, err
	}
	if sources.blocks, err = o.dayChanges.Blocks.CancelledBlocksByTenant(ctx, ids, day); err != nil {
		return sources, err
	}
	if sources.meals, err = o.dayChanges.Meals.MealCancelledSchools(ctx, ids, day); err != nil {
		return sources, err
	}
	sources.rooms, err = o.dayChanges.Rooms.ClosedRoomsByTenant(ctx, ids, day)
	return sources, err
}

// schoolsWithDayChanges keeps the schools, in their order by name, that
// have a change on day.
func schoolsWithDayChanges(schools []traegerview.TraegerSchool, sources dayChangeSources, day calendar.Date) []traegerview.SchoolDayChanges {
	result := []traegerview.SchoolDayChanges{}
	for _, school := range schools {
		id := school.ID.Int64()
		calendarDay := sources.days[id]
		cancelled, rooms, meal := max(sources.blocks[id], 0), max(sources.rooms[id], 0), sources.meals[id]
		if len(calendarDay.Closings) == 0 && len(calendarDay.Openings) == 0 && cancelled == 0 && rooms == 0 && !meal {
			continue
		}
		changes := traegerview.SchoolDayChanges{
			TraegerSchool: school, CancelledBlocks: cancelled, MealCancelled: meal, ClosedRooms: rooms,
			ClosingDays:    make([]traegerview.SchoolDayClosing, 0, len(calendarDay.Closings)),
			OpeningChanges: make([]traegerview.SchoolDayOpening, 0, len(calendarDay.Openings)),
		}
		for _, closing := range calendarDay.Closings {
			changes.ClosingDays = append(changes.ClosingDays, dayClosing(closing, day))
		}
		for _, opening := range calendarDay.Openings {
			since, until := daySpan(opening.StartDate, opening.EndDate, day)
			changes.OpeningChanges = append(changes.OpeningChanges, traegerview.SchoolDayOpening{OpensAt: opening.OpensAt, ClosesAt: opening.ClosesAt, Since: since, Until: until})
		}
		result = append(result, changes)
	}
	return result
}

// dayClosing keeps "seit" and "bis" only where the closing reaches past the
// day.
func dayClosing(closing traegerview.SchoolClosingDay, day calendar.Date) traegerview.SchoolDayClosing {
	since, until := daySpan(closing.StartDate, closing.EndDate, day)
	return traegerview.SchoolDayClosing{Name: closing.Name, Traeger: closing.Traeger, Since: since, Until: until}
}

// daySpan returns "seit" and "bis" of a range, each only where it reaches
// past the day.
func daySpan(start, end, day calendar.Date) (since, until *calendar.Date) {
	if start.Before(day) {
		first := start
		since = &first
	}
	if end.After(day) {
		last := end
		until = &last
	}
	return since, until
}

// dayChangePortsBound reports whether every read of "Heute anders" is bound.
func dayChangePortsBound(ports traegerview.DayChangePorts) bool {
	return ports.Schools != nil && ports.Days != nil && ports.Blocks != nil && ports.Meals != nil && ports.Rooms != nil
}
