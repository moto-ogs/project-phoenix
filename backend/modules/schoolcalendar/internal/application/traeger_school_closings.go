package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ traegercalendar.SchoolDays = (*TraegerClosingDays)(nil)

// SchoolDaysOn reads the closing days (#7672) and the opening changes
// (#8146, #8202) of the Träger's schools on day, grouped by school in the
// order the store reads them. A school without either is missing; an empty
// school set reads nothing.
func (t *TraegerClosingDays) SchoolDaysOn(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) (map[int64]traegercalendar.SchoolDay, error) {
	if organizationID <= 0 {
		return nil, errTraegerRequired
	}
	result := map[int64]traegercalendar.SchoolDay{}
	if len(schools) == 0 {
		return result, nil
	}
	closings, openings, err := t.store.ListSchoolDays(ctx, organizationID, schools, day)
	if err != nil {
		return nil, err
	}
	for _, row := range closings {
		school := result[row.SchoolID]
		school.Closings = append(school.Closings, traegercalendar.SchoolClosing{
			StartDate: row.StartDate, EndDate: row.EndDate, Reason: row.Reason, Traeger: row.Traeger,
		})
		result[row.SchoolID] = school
	}
	for _, row := range openings {
		school := result[row.SchoolID]
		school.Openings = append(school.Openings, traegercalendar.SchoolOpening{
			StartDate: row.StartDate, EndDate: row.EndDate, OpensAt: row.OpensAt, ClosesAt: row.ClosesAt,
		})
		result[row.SchoolID] = school
	}
	return result, nil
}
