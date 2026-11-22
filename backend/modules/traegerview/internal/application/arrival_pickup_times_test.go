package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func TestArrivalPickupPeriodEndsYesterdayAndRejectsInvalidPeriods(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 11)

	from, to, err := arrivalPickupPeriod(calendar.NewDate(2026, 10, 12), calendar.NewDate(2026, 11, 20), today)
	require.NoError(t, err)
	assert.Equal(t, calendar.NewDate(2026, 10, 12), from)
	assert.Equal(t, calendar.NewDate(2026, 11, 10), to, "today's pickups are not over: the period ends yesterday")

	for name, period := range map[string][2]calendar.Date{
		"missing start":      {"", calendar.NewDate(2026, 11, 1)},
		"reversed":           {calendar.NewDate(2026, 11, 5), calendar.NewDate(2026, 11, 1)},
		"only today":         {today, today},
		"longer than a year": {calendar.NewDate(2025, 11, 8), calendar.NewDate(2026, 11, 9)},
	} {
		_, _, err := arrivalPickupPeriod(period[0], period[1], today)
		assert.ErrorIs(t, err, traegerview.ErrInvalidArrivalPickupPeriod, name)
	}
	_, _, err = arrivalPickupPeriod(calendar.NewDate(2025, 11, 10), calendar.NewDate(2026, 11, 10), today)
	assert.NoError(t, err, "366 days are allowed")
}

func TestBuildArrivalPickupTimesAveragesPerSchoolDayAndAddsTheSchools(t *testing.T) {
	t.Parallel()
	park := traegerview.TraegerSchool{ID: 1, Name: "OGS Am Park"}
	wald := traegerview.TraegerSchool{ID: 2, Name: "OGS Waldweg"}
	empty := traegerview.TraegerSchool{ID: 3, Name: "OGS Neu"}
	from, to := calendar.NewDate(2026, 10, 1), calendar.NewDate(2026, 10, 31)
	counts := []traegerview.ArrivalPickupCount{
		{SchoolID: park.ID.Int64(), Weekday: 1, StartMinute: 7*60 + 30, Arrivals: 10},
		{SchoolID: park.ID.Int64(), Weekday: 1, StartMinute: 15 * 60, Pickups: 7},
		{SchoolID: wald.ID.Int64(), Weekday: 1, StartMinute: 7*60 + 30, Arrivals: 3},
		{SchoolID: wald.ID.Int64(), Weekday: 6, StartMinute: 9 * 60, Arrivals: 1},
		{SchoolID: wald.ID.Int64(), Weekday: 2, StartMinute: 18 * 60, Pickups: 2},
	}
	days := []traegerview.AttendanceDays{
		{SchoolID: park.ID.Int64(), Weekday: 1, Days: 4, FirstDay: calendar.NewDate(2026, 10, 5)},
		{SchoolID: wald.ID.Int64(), Weekday: 1, Days: 3, FirstDay: calendar.NewDate(2026, 10, 12)},
		{SchoolID: wald.ID.Int64(), Weekday: 2, Days: 2, FirstDay: calendar.NewDate(2026, 10, 6)},
		{SchoolID: wald.ID.Int64(), Weekday: 6, Days: 1, FirstDay: calendar.NewDate(2026, 10, 17)},
	}

	result := buildArrivalPickupTimes([]traegerview.TraegerSchool{park, wald, empty}, counts, days, from, to)

	assert.Equal(t, 7*60, result.FirstMinute)
	assert.Equal(t, 18*60, result.LastMinute, "a pickup at 18:00 widens the axis past 17:30")
	assert.Equal(t, traegerview.ArrivalPickupSlotMinutes, result.SlotMinutes)
	require.Len(t, result.Schools, 3)
	assert.Equal(t, []int{1, 2, 3, 4, 5, 6}, weekdaysOf(result.All), "Saturday joins because a school recorded it; Sunday does not")

	parkMonday := result.Schools[0].Weekdays[0]
	assert.Equal(t, 4, parkMonday.Days)
	assert.InDelta(t, 2.5, cellAt(t, parkMonday, 7*60+30).Arrivals, 0.001, "10 arrivals over 4 Mondays")
	assert.InDelta(t, 1.8, cellAt(t, parkMonday, 15*60).Pickups, 0.001, "7 pickups over 4 Mondays, one decimal")
	assert.Equal(t, calendar.NewDate(2026, 10, 5), *result.Schools[0].FirstDay)

	waldMonday := result.Schools[1].Weekdays[0]
	assert.InDelta(t, 1, cellAt(t, waldMonday, 7*60+30).Arrivals, 0.001)
	assert.Equal(t, calendar.NewDate(2026, 10, 6), *result.Schools[1].FirstDay, "the first day over every weekday")

	allMonday := result.All.Weekdays[0]
	assert.InDelta(t, 3.5, cellAt(t, allMonday, 7*60+30).Arrivals, 0.001, "all schools add their averages")
	assert.InDelta(t, 1.8, cellAt(t, allMonday, 15*60).Pickups, 0.001, "the sum is rounded once, from 1.75")
	assert.Equal(t, 4, allMonday.Days, "the most days of one school")

	assert.Nil(t, result.Schools[2].FirstDay, "a school without attendance has no first day")
	for _, row := range result.Schools[2].Weekdays {
		assert.Zero(t, row.Days)
		assert.Len(t, row.Slots, len(allMonday.Slots), "every school shares the axis")
	}
}

func TestBuildArrivalPickupTimesWithoutSchoolsKeepsTheDefaultAxis(t *testing.T) {
	t.Parallel()

	result := buildArrivalPickupTimes(nil, nil, nil, calendar.NewDate(2026, 10, 1), calendar.NewDate(2026, 10, 2))

	assert.Equal(t, 7*60, result.FirstMinute)
	assert.Equal(t, 17*60, result.LastMinute)
	assert.Empty(t, result.Schools)
	assert.Equal(t, []int{1, 2, 3, 4, 5}, weekdaysOf(result.All))
	assert.Len(t, result.All.Weekdays[0].Slots, 21, "07:00 to 17:30 in half hours")
}

func weekdaysOf(heatmap traegerview.ArrivalPickupHeatmap) []int {
	days := make([]int, len(heatmap.Weekdays))
	for i, row := range heatmap.Weekdays {
		days[i] = row.Weekday
	}
	return days
}

func cellAt(t *testing.T, row traegerview.ArrivalPickupWeekday, minute int) traegerview.ArrivalPickupCell {
	t.Helper()
	for _, cell := range row.Slots {
		if cell.StartMinute == minute {
			return cell
		}
	}
	t.Fatalf("no slot at minute %d", minute)
	return traegerview.ArrivalPickupCell{}
}
