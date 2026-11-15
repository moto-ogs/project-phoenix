package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func date(t *testing.T, value string) calendar.Date {
	t.Helper()
	day, err := calendar.ParseDate(value)
	require.NoError(t, err)
	return day
}

func intPtr(value int) *int { return &value }

func TestUtilizationWeekdaysSkipTheWeekend(t *testing.T) {
	t.Parallel()
	// Friday 2026-09-04 to Tuesday 2026-09-08.
	days := utilizationWeekdays(date(t, "2026-09-04"), date(t, "2026-09-08"))
	assert.Equal(t, []calendar.Date{date(t, "2026-09-04"), date(t, "2026-09-07"), date(t, "2026-09-08")}, days)
}

func TestFinishedUntilLeavesTodayOut(t *testing.T) {
	t.Parallel()
	today := date(t, "2026-09-09")
	last, ok := finishedUntil(date(t, "2026-09-01"), today, today)
	assert.True(t, ok)
	assert.Equal(t, date(t, "2026-09-08"), last, "today is not over yet")
	last, ok = finishedUntil(date(t, "2026-09-01"), date(t, "2026-09-04"), today)
	assert.True(t, ok)
	assert.Equal(t, date(t, "2026-09-04"), last, "a past window stays as it is")
	_, ok = finishedUntil(today, today, today)
	assert.False(t, ok, "a window of today only has no finished day")
}

func TestUnbookedOfferingsCountOnlyInAWindowReachingToday(t *testing.T) {
	t.Parallel()
	today := date(t, "2026-09-09")
	running := []int64{7}
	assert.Equal(t, running, unbookedOfferingPhases(today, today, running))
	// Last school year: this year's offering without a booking stays out.
	assert.Nil(t, unbookedOfferingPhases(date(t, "2026-07-31"), today, running))
	assert.Nil(t, unbookedOfferingPhases(date(t, "2026-09-08"), today, running))
}

func TestValidateUtilizationWindow(t *testing.T) {
	t.Parallel()
	today := date(t, "2026-09-09")
	cases := map[string]struct {
		from, to calendar.Date
		ok       bool
	}{
		"today only":        {today, today, true},
		"a school year":     {date(t, "2025-09-09"), today, true},
		"missing":           {calendar.Date(""), today, false},
		"reversed":          {today, date(t, "2026-09-01"), false},
		"in the future":     {today, date(t, "2026-09-10"), false},
		"longer than limit": {date(t, "2025-09-08"), today, false},
	}
	for name, tc := range cases {
		err := validateUtilizationWindow(tc.from, tc.to, today)
		if tc.ok {
			assert.NoError(t, err, name)
		} else {
			assert.ErrorIs(t, err, traegerview.ErrInvalidUtilizationWindow, name)
		}
	}
}

func TestOfferingSeriesCountsTakenChildrenOncePerOfferAndDay(t *testing.T) {
	t.Parallel()
	mon, tue, wed := date(t, "2026-09-07"), date(t, "2026-09-08"), date(t, "2026-09-09")
	days := []calendar.Date{mon, tue, wed}
	const (
		anna, ben, cem             int64 = 10, 11, 12
		annaR, annaR2, benR, cemR  int64 = 30, 31, 32, 33
		unapprovedR                int64 = 34
		ogs, early, unlimited, old int64 = 1, 2, 3, 4
	)
	children := map[int64]int64{annaR: anna, annaR2: anna, benR: ben, cemR: cem}
	offerings := []traegerview.OfferingBookingIntervals{
		{ID: ogs, Name: "OGS bis 16 Uhr", Capacity: intPtr(2), Active: true, Bookings: []traegerview.BookingInterval{
			{RequestChildID: annaR},
			{RequestChildID: annaR2, ValidFrom: &tue}, // a second booking of Anna counts her once
			{RequestChildID: benR, ValidUntil: &tue},  // ends before Tuesday
			{RequestChildID: unapprovedR},             // never taken on
		}},
		{ID: early, Name: "Frühbetreuung", Capacity: intPtr(10), Active: true, Bookings: []traegerview.BookingInterval{
			{RequestChildID: annaR, ValidFrom: &wed},
			{RequestChildID: cemR, ValidFrom: &tue},
		}},
		{ID: unlimited, Name: "Hausaufgaben", Active: true, Bookings: []traegerview.BookingInterval{{RequestChildID: benR}}},
	}

	got := offeringSeries(offerings, children, days)

	require.Len(t, got.offerings, 3)
	assert.Equal(t, []int{2, 1, 1}, got.offerings[0].Booked)
	assert.Equal(t, []int{0, 1, 2}, got.offerings[1].Booked)
	assert.Equal(t, []int{1, 1, 1}, got.offerings[2].Booked)
	assert.Equal(t, 12, got.places, "only offerings with a limit add places")
	assert.Equal(t, []int{2, 2, 3}, got.bookedPlaces, "booked children of the limited offerings")
	assert.Equal(t, []int{2, 3, 3}, got.booked, "each child once over all offerings: Mon Anna+Ben, Tue Anna+Cem+Ben, Wed Anna+Cem+Ben")
}

func TestPresentSeriesHidesDaysWithoutData(t *testing.T) {
	t.Parallel()
	mon, tue, wed, thu := date(t, "2026-09-07"), date(t, "2026-09-08"), date(t, "2026-09-09"), date(t, "2026-09-10")
	days := []calendar.Date{mon, tue, wed, thu}
	counts := traegerview.DailyCounts{From: &tue, Counts: map[calendar.Date]int{mon: 5, tue: 7, thu: 4}}

	got := presentSeries(counts, days)

	assert.Equal(t, []*int{nil, intPtr(7), nil, intPtr(4)}, got, "before the first kept day and on a day without check-in there is no figure")
	assert.Equal(t, []*int{nil, nil, nil, nil}, presentSeries(traegerview.DailyCounts{}, days))
}

func TestRoomSeriesListsRoomsWithVisitsAndHidesClosedDays(t *testing.T) {
	t.Parallel()
	mon, tue, wed := date(t, "2026-09-07"), date(t, "2026-09-08"), date(t, "2026-09-09")
	days := []calendar.Date{mon, tue, wed}
	const gym, library, attic, gone int64 = 1, 2, 3, 4
	names := []traegerview.NamedRoom{
		{ID: library, Name: "Bücherei", Capacity: intPtr(12)},
		{ID: attic, Name: "Dachboden"},
		{ID: gym, Name: "Turnhalle", Capacity: intPtr(30)},
	}
	visits := traegerview.SchoolRoomVisits{From: &mon, Days: []traegerview.RoomVisitDay{
		{RoomID: gym, Day: mon, Children: 20, Peak: 14},
		{RoomID: library, Day: mon, Children: 3, Peak: 2},
		{RoomID: gym, Day: wed, Children: 9, Peak: 9},
		{RoomID: gone, Day: wed, Children: 1, Peak: 1},
	}}

	got := roomSeries(names, visits, days)

	require.Len(t, got, 2, "a room without a visit and a room without a name are not listed")
	assert.Equal(t, "Bücherei", got[0].Name)
	assert.Equal(t, []*int{intPtr(3), nil, intPtr(0)}, got[0].Children, "Tuesday had no visit at the school, Wednesday the room stayed empty")
	assert.Equal(t, []*int{intPtr(2), nil, intPtr(0)}, got[0].Peak)
	assert.Equal(t, "Turnhalle", got[1].Name)
	assert.Equal(t, []*int{intPtr(14), nil, intPtr(9)}, got[1].Peak)
	assert.Equal(t, intPtr(30), got[1].Capacity)
}
