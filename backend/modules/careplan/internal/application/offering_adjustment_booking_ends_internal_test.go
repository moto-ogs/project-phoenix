package application

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// The ends an adjustment keeps (#7909). The phase ends with July.
func TestKeepBookingEnds(t *testing.T) {
	t.Parallel()
	const care, other, lunch, late = 1, 2, 3, 4
	phaseEnd := calendar.NewDate(2027, 8, 1)
	august, march, may := calendar.NewDate(2026, 9, 1), calendar.NewDate(2027, 3, 1), calendar.NewDate(2027, 5, 1)
	stored := func(offering int64, from calendar.Date, until *calendar.Date) *careplan.BookedOffering {
		return &careplan.BookedOffering{CareOfferingID: offering, ManualSelectedDays: []string{"mon"}, ValidFrom: &from, ValidUntil: until}
	}
	manual := func(offering int64) *careplan.BookedOffering {
		return &careplan.BookedOffering{CareOfferingID: offering, ManualSelectedDays: []string{"mon"}}
	}
	automatic := func(offering int64) *careplan.BookedOffering {
		return &careplan.BookedOffering{CareOfferingID: offering, AutomaticSelectedDays: []string{"mon"}}
	}
	offerings := map[int64]*careplan.CareOffering{
		care: {ID: care}, other: {ID: other},
		late:  {ID: late, AutoAddTriggerOfferingIDs: []int64{care}},
		lunch: {ID: lunch, IsRequired: true, IncludesLunch: true, DaysOfWeekMode: daysOfWeekModeParentChoice},
	}
	ends := func(rows []*careplan.BookedOffering) map[int64]*calendar.Date {
		result := map[int64]*calendar.Date{}
		for _, row := range rows {
			result[row.CareOfferingID] = row.ValidUntil
		}
		return result
	}

	for name, tc := range map[string]struct {
		history     []*careplan.BookedOffering
		before      []int // indexes into history: the bookings in effect
		replacement []*careplan.BookedOffering
		want        map[int64]*calendar.Date
	}{
		"a kept offering keeps its end": {
			history: []*careplan.BookedOffering{stored(care, august, &march)}, before: []int{0},
			replacement: []*careplan.BookedOffering{manual(care), manual(other)},
			want:        map[int64]*calendar.Date{care: &march, other: nil},
		},
		"a chain of the same offering keeps its last end": {
			history: []*careplan.BookedOffering{stored(care, august, &march), stored(care, march, &may)}, before: []int{0},
			replacement: []*careplan.BookedOffering{manual(care)},
			want:        map[int64]*calendar.Date{care: &may},
		},
		"an end where another booking starts is a change, not an end": {
			history: []*careplan.BookedOffering{stored(care, august, &march), stored(other, march, nil)}, before: []int{0},
			replacement: []*careplan.BookedOffering{manual(care)},
			want:        map[int64]*calendar.Date{care: nil},
		},
		"an open booking and one to the end of the phase keep nothing": {
			history: []*careplan.BookedOffering{stored(care, august, nil), stored(other, august, &phaseEnd)}, before: []int{0, 1},
			replacement: []*careplan.BookedOffering{manual(care), manual(other)},
			want:        map[int64]*calendar.Date{care: nil, other: nil},
		},
		"a co-booking ends with its trigger": {
			history: []*careplan.BookedOffering{stored(care, august, &march)}, before: []int{0},
			replacement: []*careplan.BookedOffering{manual(care), automatic(late)},
			want:        map[int64]*calendar.Date{care: &march, late: &march},
		},
		"a co-booking goes on with a trigger that goes on": {
			history: []*careplan.BookedOffering{stored(late, august, &march)}, before: []int{0},
			replacement: []*careplan.BookedOffering{manual(care), automatic(late)},
			want:        map[int64]*calendar.Date{care: nil, late: nil},
		},
		"a required lunch ends with the last care": {
			history: []*careplan.BookedOffering{stored(care, august, &march), stored(other, august, &may)}, before: []int{0, 1},
			replacement: []*careplan.BookedOffering{manual(care), manual(other), automatic(lunch)},
			want:        map[int64]*calendar.Date{care: &march, other: &may, lunch: &may},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			before := make([]*careplan.BookedOffering, 0, len(tc.before))
			for _, i := range tc.before {
				before = append(before, tc.history[i])
			}
			keepBookingEnds(tc.replacement, before, tc.history, offerings, phaseEnd)
			assert.Equal(t, tc.want, ends(tc.replacement))
		})
	}

	// The care end on a row wins when it is earlier, and a co-booking of a
	// co-booking follows the chain.
	careEnd := calendar.NewDate(2027, 2, 1)
	capped := manual(care)
	capped.ValidUntil = &careEnd
	keepBookingEnds([]*careplan.BookedOffering{capped}, []*careplan.BookedOffering{stored(care, august, &march)},
		[]*careplan.BookedOffering{stored(care, august, &march)}, offerings, phaseEnd)
	assert.Equal(t, careEnd, *capped.ValidUntil)
	chained := map[int64]*careplan.CareOffering{care: {ID: care}, late: offerings[late], other: {ID: other, AutoAddTriggerOfferingIDs: []int64{late}}}
	rows := []*careplan.BookedOffering{automatic(other), automatic(late), manual(care)}
	keepBookingEnds(rows, []*careplan.BookedOffering{stored(care, august, &march)}, []*careplan.BookedOffering{stored(care, august, &march)}, chained, phaseEnd)
	assert.Equal(t, map[int64]*calendar.Date{care: &march, late: &march, other: &march}, ends(rows))
}
