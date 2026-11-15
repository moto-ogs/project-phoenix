package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func TestAbsenceWindowStartsWithTheSchoolYearAndEndsYesterday(t *testing.T) {
	t.Parallel()
	today := date(t, "2026-11-15")
	cases := map[string]struct {
		keyDate  calendar.Date
		from, to calendar.Date
		ok       bool
	}{
		"September: the school year of that August":  {date(t, "2026-09-15"), date(t, "2026-08-01"), date(t, "2026-09-15"), true},
		"February: the school year of August before": {date(t, "2026-02-28"), date(t, "2025-08-01"), date(t, "2026-02-28"), true},
		"1 August: the first day of the school year": {date(t, "2026-08-01"), date(t, "2026-08-01"), date(t, "2026-08-01"), true},
		"31 July: the last day of the school year":   {date(t, "2026-07-31"), date(t, "2025-08-01"), date(t, "2026-07-31"), true},
		"today: up to yesterday, which is over":      {today, date(t, "2026-08-01"), date(t, "2026-11-14"), true},
		"the future: up to yesterday":                {date(t, "2027-03-01"), date(t, "2026-08-01"), date(t, "2026-11-14"), true},
		"a later school year: no day of it is over":  {date(t, "2027-09-01"), "", "", false},
	}
	for name, c := range cases {
		window, ok := absenceWindow(c.keyDate, today)
		require.Equal(t, c.ok, ok, name)
		if ok {
			assert.Equal(t, traegerview.ReportWindow{From: c.from, To: c.to}, window, name)
		}
	}
	_, ok := absenceWindow(date(t, "2026-08-01"), date(t, "2026-08-01"))
	assert.False(t, ok, "the first day of the school year is not over on that day")
}

func TestValidateKeyDate(t *testing.T) {
	t.Parallel()
	today := date(t, "2026-11-15")
	for keyDate, ok := range map[calendar.Date]bool{
		"":                    false,
		date(t, "1999-12-31"): false,
		date(t, "2000-01-01"): true,
		today:                 true,
		today.AddDays(366):    true,
		today.AddDays(367):    false,
	} {
		err := validateKeyDate(keyDate, today)
		if ok {
			assert.NoError(t, err, keyDate)
		} else {
			assert.ErrorIs(t, err, traegerview.ErrInvalidKeyDate, keyDate)
		}
	}
}

func TestCompleteFiguresDerivesRatiosAndDemand(t *testing.T) {
	t.Parallel()
	figures := completeFigures(traegerview.KeyDateFigures{
		Children: 30, WithoutCareForm: 5, Staff: 4, PresentDays: 90, SickDays: 6, ExcusedDays: 4, Open: 2, Waitlisted: 3,
	}, []traegerview.KeyDateCareForm{
		{Name: "OGS", Children: 22, Capacity: intPtr(20), Active: true},
		{Name: "Früh", Children: 3, Active: true},
		{Name: "Alt", Children: 1, Capacity: intPtr(10), Active: false},
	})
	require.NotNil(t, figures.ChildrenPerStaff)
	assert.InDelta(t, 7.5, *figures.ChildrenPerStaff, 1e-9)
	require.NotNil(t, figures.AbsenceRate)
	assert.InDelta(t, 10.0, *figures.AbsenceRate, 1e-9, "10 absent of 100 days")
	assert.Equal(t, 20, figures.Places, "only active forms with a capacity")
	assert.Equal(t, 22, figures.BookedPlaces)
	assert.Zero(t, figures.FreePlaces, "an overbooked form has no free places, never below 0")
	assert.Equal(t, 25, figures.Booked)
	assert.Equal(t, 30, figures.Demand)

	empty := completeFigures(traegerview.KeyDateFigures{}, nil)
	assert.Nil(t, empty.ChildrenPerStaff, "no staff, no ratio")
	assert.Nil(t, empty.AbsenceRate, "no day, no rate")
}

func TestAggregateKeyDateSchoolsSumsSozialraeumeAndTheTotal(t *testing.T) {
	t.Parallel()
	nord := "Nord"
	school := func(id int64, district *string, children, staff int, forms ...traegerview.KeyDateCareForm) traegerview.KeyDateSchool {
		figures := completeFigures(traegerview.KeyDateFigures{Children: children, Staff: staff, PresentDays: 8, SickDays: 2}, forms)
		return traegerview.KeyDateSchool{ID: id, District: district, Figures: figures, CareForms: forms}
	}
	schools := []traegerview.KeyDateSchool{
		school(1, &nord, 10, 2, traegerview.KeyDateCareForm{Name: "OGS", Children: 10, Capacity: intPtr(12), Active: true}),
		school(2, &nord, 6, 1, traegerview.KeyDateCareForm{Name: "OGS", Children: 6, Capacity: intPtr(8), Active: true},
			traegerview.KeyDateCareForm{Name: "Früh", Children: 2, Active: true}),
		school(3, nil, 4, 0, traegerview.KeyDateCareForm{Name: "OGS", Children: 4, Active: true}),
	}
	districts, total := aggregateKeyDateSchools(schools)
	require.Len(t, districts, 2)
	assert.Equal(t, "Nord", districts[0].Name)
	assert.Equal(t, 2, districts[0].Schools)
	assert.Equal(t, 16, districts[0].Figures.Children)
	require.NotNil(t, districts[0].Figures.ChildrenPerStaff)
	assert.InDelta(t, 16.0/3, *districts[0].Figures.ChildrenPerStaff, 1e-9, "recomputed from the sums")
	require.NotNil(t, districts[0].Figures.AbsenceRate)
	assert.InDelta(t, 20.0, *districts[0].Figures.AbsenceRate, 1e-9, "4 absent of 20 days")
	assert.Equal(t, 20, districts[0].Figures.Places)
	assert.Equal(t, []traegerview.KeyDateCareForm{
		{Name: "Früh", Children: 2, Active: true},
		{Name: "OGS", Children: 16, Capacity: intPtr(20), Active: true},
	}, districts[0].CareForms, "summed by name, ordered by name")
	assert.Equal(t, traegerview.UnmappedDistrict, districts[1].Name, "the schools without a Sozialraum come last")
	assert.Equal(t, 1, districts[1].Schools)

	assert.Equal(t, 3, total.Schools)
	assert.Equal(t, 20, total.Figures.Children)
	assert.Equal(t, []traegerview.KeyDateCareForm{
		{Name: "Früh", Children: 2, Active: true},
		{Name: "OGS", Children: 20, Active: true},
	}, total.CareForms, "one form of the name without a capacity leaves the sum without one")
	assert.Equal(t, 10, schools[0].CareForms[0].Children, "the merge does not change the schools' forms")
	assert.Equal(t, 12, *schools[0].CareForms[0].Capacity)

	unmapped, _ := aggregateKeyDateSchools(schools[2:])
	assert.Empty(t, unmapped, "without any Sozialraum the report has none")
	assert.NotNil(t, unmapped)
}

func TestAggregateKeyDateSchoolsDistinguishesNamedAndUnmappedDistricts(t *testing.T) {
	t.Parallel()
	name := traegerview.UnmappedDistrict
	districts, total := aggregateKeyDateSchools([]traegerview.KeyDateSchool{
		{ID: 1, District: &name, Figures: traegerview.KeyDateFigures{Children: 3}},
		{ID: 2, Figures: traegerview.KeyDateFigures{Children: 7}},
	})
	require.Len(t, districts, 2)
	assert.False(t, districts[0].Unmapped)
	assert.True(t, districts[1].Unmapped)
	assert.Equal(t, 3, districts[0].Figures.Children)
	assert.Equal(t, 7, districts[1].Figures.Children)
	assert.Equal(t, 10, total.Figures.Children)
}
