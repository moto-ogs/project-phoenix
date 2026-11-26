package api

// The reads of "Heute anders" in the Träger-Portal (#7672). The Träger
// projection reads the closing days at School Calendar and the cancelled
// blocks at Timetable, both in its administrative unit over the Träger's
// schools. The rule of access is the route's: "Übersicht sehen" and the
// schools of the session's Träger. No source names a person or a reason.

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// traegerDayChangePorts binds the projection's day change reads to the
// Träger closing days the portal mounts and to the Timetable owner's count.
func traegerDayChangePorts(closingDays traegercalendar.ClosingDays, owner timetable.Owner) (traegerview.DayChangePorts, error) {
	if closingDays == nil || owner == nil {
		return traegerview.DayChangePorts{}, errors.New("traeger day changes: the Träger closing days and the Timetable owner are required")
	}
	closings, err := traegercalendar.SchoolClosingsOf(closingDays)
	if err != nil {
		return traegerview.DayChangePorts{}, err
	}
	blocks, err := timetable.TraegerCancelledBlocksOf(owner)
	if err != nil {
		return traegerview.DayChangePorts{}, err
	}
	return traegerview.DayChangePorts{Closings: traegerSchoolClosingDays{closings: closings}, Blocks: blocks}, nil
}

// traegerSchoolClosingDays translates School Calendar's closings into the
// projection's vocabulary.
type traegerSchoolClosingDays struct {
	closings traegercalendar.SchoolClosings
}

func (c traegerSchoolClosingDays) SchoolClosingDaysOn(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) (map[int64][]traegerview.SchoolClosingDay, error) {
	closings, err := c.closings.SchoolClosingsOn(ctx, organizationID, schools, day)
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]traegerview.SchoolClosingDay, len(closings))
	for school, listed := range closings {
		for _, closing := range listed {
			result[school] = append(result[school], traegerview.SchoolClosingDay{
				StartDate: closing.StartDate, EndDate: closing.EndDate, Name: closing.Reason, Traeger: closing.Traeger,
			})
		}
	}
	return result, nil
}
