package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ traegercalendar.SchoolClosings = (*TraegerClosingDays)(nil)

// SchoolClosingsOn reads the closing days of the Träger's schools on day
// (#7672), grouped by school in the order the store reads them. An empty
// school set reads nothing.
func (t *TraegerClosingDays) SchoolClosingsOn(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) (map[int64][]traegercalendar.SchoolClosing, error) {
	if organizationID <= 0 {
		return nil, errTraegerRequired
	}
	result := map[int64][]traegercalendar.SchoolClosing{}
	if len(schools) == 0 {
		return result, nil
	}
	rows, err := t.store.ListSchoolClosings(ctx, organizationID, schools, day)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.SchoolID] = append(result[row.SchoolID], traegercalendar.SchoolClosing{
			StartDate: row.StartDate, EndDate: row.EndDate, Reason: row.Reason, Traeger: row.Traeger,
		})
	}
	return result, nil
}
