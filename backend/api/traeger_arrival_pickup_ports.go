package api

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// traegerArrivalPickupCounts binds the Träger's heatmap of arrival and pickup
// times (#4714) to the attendance of Student Presence and translates its
// counts into the projection's vocabulary.
type traegerArrivalPickupCounts struct {
	times studentpresence.ArrivalPickupTimes
}

func (c traegerArrivalPickupCounts) ArrivalPickupCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]traegerview.ArrivalPickupCount, []traegerview.AttendanceDays, error) {
	slots, weekdays, err := c.times.ArrivalPickupTimesByTenant(ctx, schools, from, to)
	if err != nil {
		return nil, nil, err
	}
	counts := make([]traegerview.ArrivalPickupCount, len(slots))
	for i, slot := range slots {
		counts[i] = traegerview.ArrivalPickupCount{SchoolID: slot.SchoolID, Weekday: slot.Weekday, StartMinute: slot.StartMinute, Arrivals: slot.Arrivals, Pickups: slot.Pickups}
	}
	days := make([]traegerview.AttendanceDays, len(weekdays))
	for i, day := range weekdays {
		days[i] = traegerview.AttendanceDays{SchoolID: day.SchoolID, Weekday: day.Weekday, Days: day.Days, FirstDay: day.FirstDay}
	}
	return counts, days, nil
}
