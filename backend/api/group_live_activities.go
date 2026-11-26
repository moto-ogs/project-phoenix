package api

// The root binds the live group's planned offerings (#6487) to the Timetable
// read every child card shares (planned_offerings.go).

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/grouplive"
)

// PlannedActivities lists, per child, the day's offerings it is planned for,
// without cancelled ones and without care or duty blocks, by start time.
func (p groupLivePlanning) PlannedActivities(ctx context.Context, studentIDs []int64, date grouplive.Date) (map[int64][]grouplive.PlannedActivity, error) {
	rows, err := p.offerings.byStudent(ctx, studentIDs, string(date))
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]grouplive.PlannedActivity, len(rows))
	for studentID, offerings := range rows {
		for _, offering := range offerings {
			result[studentID] = append(result[studentID], grouplive.PlannedActivity(offering))
		}
	}
	return result, nil
}
