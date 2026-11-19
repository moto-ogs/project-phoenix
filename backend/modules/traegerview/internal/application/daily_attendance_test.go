package application

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func TestDailyAttendancePeriodEndsYesterdayAndAllowsAMonth(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 11)

	from, to, err := dailyAttendancePeriod(calendar.NewDate(2026, 11, 2), calendar.NewDate(2026, 11, 20), today)
	require.NoError(t, err)
	assert.Equal(t, calendar.NewDate(2026, 11, 2), from)
	assert.Equal(t, calendar.NewDate(2026, 11, 10), to, "today's pickups are not over: the period ends yesterday")

	_, _, err = dailyAttendancePeriod(calendar.NewDate(2026, 10, 1), calendar.NewDate(2026, 10, 31), today)
	assert.NoError(t, err, "31 days are allowed")
	for name, period := range map[string][2]calendar.Date{
		"missing end":    {calendar.NewDate(2026, 11, 1), ""},
		"reversed":       {calendar.NewDate(2026, 11, 5), calendar.NewDate(2026, 11, 1)},
		"only today":     {today, today},
		"longer than 31": {calendar.NewDate(2026, 10, 1), calendar.NewDate(2026, 11, 1)},
	} {
		_, _, err := dailyAttendancePeriod(period[0], period[1], today)
		assert.ErrorIs(t, err, traegerview.ErrInvalidDailyAttendancePeriod, name)
	}
}

// berlin is a Berlin wall-clock instant on day.
func berlin(t *testing.T, day calendar.Date, hour, minute int) time.Time {
	t.Helper()
	return day.BerlinMidnight().Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute)
}

func dailyAttendanceFixture(t *testing.T) dailyAttendanceData {
	t.Helper()
	friday, saturday, monday := calendar.NewDate(2026, 11, 6), calendar.NewDate(2026, 11, 7), calendar.NewDate(2026, 11, 9)
	stay := func(school, student int64, day calendar.Date, from, to [2]int) traegerview.ChildDay {
		left := berlin(t, day, to[0], to[1])
		return traegerview.ChildDay{SchoolID: school, Date: day, StudentID: student, ArrivedAt: berlin(t, day, from[0], from[1]), LeftAt: &left}
	}
	open := traegerview.ChildDay{SchoolID: 1, Date: friday, StudentID: 13, ArrivedAt: berlin(t, friday, 7, 5)}
	return dailyAttendanceData{
		from: friday, to: monday, other: 2,
		schools: []traegerview.TraegerSchool{{ID: 2, Name: "Hort am Hafen"}, {ID: 1, Name: "Hort Warnowblick"}},
		days: []traegerview.ChildDay{
			stay(1, 11, friday, [2]int{11, 45}, [2]int{16, 15}), // 270 minutes
			stay(1, 12, friday, [2]int{7, 30}, [2]int{15, 0}),   // 450 minutes
			open,
			stay(1, 11, monday, [2]int{12, 0}, [2]int{14, 0}), // 120 minutes
			stay(2, 21, saturday, [2]int{9, 0}, [2]int{12, 0}),
		},
		absences: []traegerview.AbsenceDay{
			{SchoolID: 1, Date: friday, StudentID: 14, Status: traegerview.AttendanceSick},
			{SchoolID: 1, Date: friday, StudentID: 11, Status: traegerview.AttendanceSick},
			{SchoolID: 1, Date: monday, StudentID: 12, Status: traegerview.AttendanceExcused},
			{SchoolID: 2, Date: monday, StudentID: 22, Status: traegerview.AttendanceClassTrip},
		},
	}
}

func TestBuildDailyAttendanceCountsChildDaysAndSetsPresenceBeforeAbsence(t *testing.T) {
	t.Parallel()
	data := dailyAttendanceFixture(t)

	result := buildDailyAttendance(data)

	assert.Equal(t, traegerview.FederalStateMecklenburgVorpommern, result.FederalState)
	assert.Equal(t, 2, result.OtherSchools)
	require.Len(t, result.Schools, 2)
	hafen, warnow := result.Schools[0], result.Schools[1]
	assert.Equal(t, "Hort am Hafen", hafen.Name, "schools keep the order of their rows")

	require.Len(t, warnow.Days, 2, "Friday and Monday; the empty Saturday and Sunday are left out")
	friday := warnow.Days[0]
	assert.Equal(t, 3, friday.Present)
	assert.Equal(t, 1, friday.Sick, "the present child's sick day does not count")
	assert.Equal(t, 1, friday.WithoutPickup, "the open stay has no pickup")
	require.NotNil(t, friday.AverageMinutes)
	assert.Equal(t, 360, *friday.AverageMinutes, "(270 + 450) / 2, the open stay left out")
	assert.Equal(t, 450, *friday.LongestMinutes)
	assert.True(t, friday.FirstArrival.Equal(berlin(t, data.from, 7, 5)), "the open stay still arrived")
	assert.True(t, friday.LastPickup.Equal(berlin(t, data.from, 16, 15)))
	assert.Equal(t, 1, warnow.Days[1].Excused)

	require.Len(t, hafen.Days, 3, "Friday, the Saturday with a child, Monday")
	assert.Equal(t, calendar.NewDate(2026, 11, 7), hafen.Days[1].Date)
	assert.Zero(t, hafen.Days[0].Present, "a weekday without children stays in the list")
	assert.Nil(t, hafen.Days[0].AverageMinutes)
	assert.Equal(t, 1, hafen.Days[2].ClassTrip)

	assert.Equal(t, 4, warnow.Summary.Present)
	assert.Equal(t, 2, warnow.Summary.DaysWithChildren)
	assert.InDelta(t, 2.0, warnow.Summary.PresentPerDay, 0.001)
	assert.Equal(t, 280, *warnow.Summary.AverageMinutes, "(270 + 450 + 120) / 3")

	require.Len(t, result.Days, 3, "all schools: Friday, Saturday, Monday")
	assert.Equal(t, 3, result.Days[0].Present)
	assert.Equal(t, 5, result.Summary.Present)
	assert.Equal(t, 3, result.Summary.DaysWithChildren)
	assert.Equal(t, 2, result.Summary.Sick+result.Summary.Excused)
	assert.Equal(t, 1, result.Summary.ClassTrip)
	assert.Equal(t, 450, *result.Summary.LongestMinutes)
}

func TestBuildDailyAttendanceWithoutSchoolsInMecklenburgVorpommern(t *testing.T) {
	t.Parallel()
	result := buildDailyAttendance(dailyAttendanceData{from: calendar.NewDate(2026, 11, 2), to: calendar.NewDate(2026, 11, 6), other: 3, schools: []traegerview.TraegerSchool{}})

	assert.Empty(t, result.Schools)
	assert.NotNil(t, result.Schools, "an empty list, never null")
	assert.Empty(t, result.Days)
	assert.Equal(t, 3, result.OtherSchools)
	assert.Zero(t, result.Summary.PresentPerDay)
}

func TestBuildDailyAttendanceExportListsAnonymousRecords(t *testing.T) {
	t.Parallel()
	data := dailyAttendanceFixture(t)

	export := buildDailyAttendanceExport(data)

	require.Len(t, export.Records, 8, "five stays and three absences; the present child's sick day is left out")
	first := export.Records[0]
	assert.Equal(t, data.schools[0].ID, first.SchoolID, "Hort am Hafen comes first by name")
	assert.Equal(t, traegerview.AttendancePresent, first.Status)
	assert.Equal(t, traegerview.AttendanceClassTrip, export.Records[1].Status)
	assert.Nil(t, export.Records[1].ArrivedAt, "an absence has no times")

	warnowFriday := export.Records[2:6]
	assert.Equal(t, []string{traegerview.AttendancePresent, traegerview.AttendancePresent, traegerview.AttendancePresent, traegerview.AttendanceSick},
		[]string{warnowFriday[0].Status, warnowFriday[1].Status, warnowFriday[2].Status, warnowFriday[3].Status})
	assert.True(t, warnowFriday[0].ArrivedAt.Equal(berlin(t, data.from, 7, 5)), "ordered by arrival, never by child")
	assert.Nil(t, warnowFriday[0].LeftAt, "the open stay has no pickup")
	assert.Nil(t, warnowFriday[0].Minutes)
	require.NotNil(t, warnowFriday[1].Minutes)
	assert.Equal(t, 450, *warnowFriday[1].Minutes)
	assert.Equal(t, traegerview.AttendanceExcused, export.Records[7].Status)
}
