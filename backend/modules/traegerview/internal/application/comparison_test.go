package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

func TestCompareSchoolsDerivesEveryFigureFromTheSeries(t *testing.T) {
	t.Parallel()
	from, to := date(t, "2026-09-07"), date(t, "2026-09-09")
	late := date(t, "2026-09-08")
	schools := []traegerview.SchoolUtilization{
		{
			TraegerSchool: traegerview.TraegerSchool{ID: 1, Name: "OGS Am Bach"},
			Places:        20, Booked: []int{16, 17, 19}, BookedPlaces: []int{15, 16, 17},
			Present:        []*int{intPtr(12), nil, intPtr(15)},
			AttendanceFrom: &from,
		},
		{
			TraegerSchool: traegerview.TraegerSchool{ID: 2, Name: "OGS Lindenweg"},
			Booked:        []int{4, 4, 2}, BookedPlaces: []int{0, 0, 0},
			Present:        []*int{nil, intPtr(3), intPtr(5)},
			AttendanceFrom: &late,
		},
	}
	// 21 actively managed children of school 1 on the window's last day:
	// student → membership; only the count matters.
	roster := map[int64]map[int64]int64{1: {}}
	for student := range 21 {
		roster[1][int64(student)+100] = int64(student) + 200
	}

	got := compareSchools(schools, roster, from, to, 3)

	require.Len(t, got.Schools, 2)
	bach := got.Schools[0].Values
	assert.InDelta(t, 20, bach[traegerview.ComparisonPlaces], 1e-9)
	assert.InDelta(t, 48.0/60, bach[traegerview.ComparisonPlacesRate], 1e-9, "booked places of all days over places times days")
	assert.InDelta(t, 4, bach[traegerview.ComparisonFreePlaces], 1e-9, "20 places minus 16 booked on average")
	assert.InDelta(t, 52.0/3, bach[traegerview.ComparisonBooked], 1e-9)
	assert.InDelta(t, 3, bach[traegerview.ComparisonBookedChange], 1e-9, "19 on the last weekday, 16 on the first")
	assert.InDelta(t, 13.5, bach[traegerview.ComparisonPresent], 1e-9, "a day without check-ins does not count")
	assert.InDelta(t, 15, bach[traegerview.ComparisonPresentPeak], 1e-9)
	assert.InDelta(t, 21, bach[traegerview.ComparisonActiveStudents], 1e-9, "the roster of the window's last day")

	linden := got.Schools[1].Values
	for _, key := range []string{traegerview.ComparisonPlaces, traegerview.ComparisonPlacesRate, traegerview.ComparisonFreePlaces} {
		assert.NotContains(t, linden, key, "%s: no figure without places, not 0", key)
	}
	assert.InDelta(t, 0, linden[traegerview.ComparisonActiveStudents], 1e-9, "an empty roster is a count of 0, not a missing figure")
	assert.Contains(t, linden, traegerview.ComparisonActiveStudents)
	assert.InDelta(t, -2, linden[traegerview.ComparisonBookedChange], 1e-9)

	assert.InDelta(t, 20, got.Average[traegerview.ComparisonPlaces], 1e-9, "the mean over the schools that have places")
	assert.InDelta(t, (52.0/3+10.0/3)/2, got.Average[traegerview.ComparisonBooked], 1e-9)
	assert.InDelta(t, 0.5, got.Average[traegerview.ComparisonBookedChange], 1e-9)

	assert.InDelta(t, 20, got.Together[traegerview.ComparisonPlaces], 1e-9)
	assert.InDelta(t, 48.0/60, got.Together[traegerview.ComparisonPlacesRate], 1e-9, "only schools with places add place days")
	assert.InDelta(t, 62.0/3, got.Together[traegerview.ComparisonBooked], 1e-9)
	assert.InDelta(t, 1, got.Together[traegerview.ComparisonBookedChange], 1e-9)
	assert.InDelta(t, 17.5, got.Together[traegerview.ComparisonPresent], 1e-9, "the sum of the schools' averages")
	assert.NotContains(t, got.Together, traegerview.ComparisonPresentPeak, "peaks fall on different days")
	assert.InDelta(t, 21, got.Together[traegerview.ComparisonActiveStudents], 1e-9)

	require.NotNil(t, got.AttendanceFrom)
	assert.Equal(t, late, *got.AttendanceFrom, "the latest first day with check-ins after the start")
}

func TestCompareSchoolsWithOneWeekdayHasNoChange(t *testing.T) {
	t.Parallel()
	day := date(t, "2026-09-07")
	got := compareSchools([]traegerview.SchoolUtilization{{
		TraegerSchool: traegerview.TraegerSchool{ID: 1}, Places: 10, Booked: []int{5}, BookedPlaces: []int{5}, Present: []*int{nil},
	}}, nil, day, day, 1)
	values := got.Schools[0].Values
	assert.NotContains(t, values, traegerview.ComparisonBookedChange)
	assert.NotContains(t, values, traegerview.ComparisonPresent, "no check-in, no figure")
	assert.InDelta(t, 0.5, values[traegerview.ComparisonPlacesRate], 1e-9)
	assert.Nil(t, got.AttendanceFrom)
}

func TestCompareSchoolsWithOnlyWeekendDaysKeepsPlaces(t *testing.T) {
	t.Parallel()
	from, to := date(t, "2026-09-12"), date(t, "2026-09-13")
	days := utilizationWeekdays(from, to)
	require.Empty(t, days)
	got := compareSchools([]traegerview.SchoolUtilization{
		{TraegerSchool: traegerview.TraegerSchool{ID: 1}, Places: 10},
		{TraegerSchool: traegerview.TraegerSchool{ID: 2}, Places: 20},
		{TraegerSchool: traegerview.TraegerSchool{ID: 3}},
	}, nil, from, to, len(days))

	require.Len(t, got.Schools, 3)
	active := traegerview.ComparisonActiveStudents
	assert.Equal(t, traegerview.ComparisonValues{traegerview.ComparisonPlaces: 10, active: 0}, got.Schools[0].Values)
	assert.Equal(t, traegerview.ComparisonValues{traegerview.ComparisonPlaces: 20, active: 0}, got.Schools[1].Values)
	assert.Equal(t, traegerview.ComparisonValues{active: 0}, got.Schools[2].Values, "no place figure without a place limit")
	assert.Equal(t, traegerview.ComparisonValues{traegerview.ComparisonPlaces: 15, active: 0}, got.Average)
	assert.Equal(t, traegerview.ComparisonValues{traegerview.ComparisonPlaces: 30, active: 0}, got.Together)
}

func TestComparisonScopeKeepsOnlySchoolsOfTheTraeger(t *testing.T) {
	t.Parallel()
	scope, err := comparisonScope([]int64{3, 1, 2}, nil)
	require.NoError(t, err)
	assert.Equal(t, []int64{3, 1, 2}, scope, "no choice compares every school")
	scope, err = comparisonScope([]int64{3, 1, 2}, []int64{2, 3})
	require.NoError(t, err)
	assert.Equal(t, []int64{3, 2}, scope)
	_, err = comparisonScope([]int64{3, 1, 2}, []int64{2, 9})
	assert.ErrorIs(t, err, traegerview.ErrSchoolOutsideTraeger)
}
