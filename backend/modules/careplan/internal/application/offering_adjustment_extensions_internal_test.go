package application

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// The office extends a limited booking to the end of the phase (#7929): an
// extended offering keeps no end, the others keep theirs, and a co-booking
// goes on with its extended trigger. A change scheduled after today stays
// and closes the extension where it starts. Today is 4 January, the phase
// ends with July.
func TestKeepUnextendedBookingEnds(t *testing.T) {
	t.Parallel()
	const care, other, late = 1, 2, 3
	august, march, may := calendar.NewDate(2026, 9, 1), calendar.NewDate(2027, 3, 1), calendar.NewDate(2027, 5, 1)
	stored := func(offering int64, from calendar.Date, until calendar.Date) *careplan.BookedOffering {
		return &careplan.BookedOffering{CareOfferingID: offering, ManualSelectedDays: []string{"mon"}, ValidFrom: &from, ValidUntil: &until}
	}
	manual := func(offering int64) *careplan.BookedOffering {
		return &careplan.BookedOffering{CareOfferingID: offering, SelectedDays: []string{"mon"}, ManualSelectedDays: []string{"mon"}}
	}
	weekdays := []string{"mon", "tue", "wed", "thu", "fri"}
	offerings := map[int64]*careplan.CareOffering{
		care:  {ID: care, DaysOfWeekMode: daysOfWeekModeParentChoice, AvailableDays: weekdays, CountsAsCare: true},
		other: {ID: other, DaysOfWeekMode: daysOfWeekModeParentChoice, AvailableDays: weekdays, CountsAsCare: true},
		late:  {ID: late, DaysOfWeekMode: daysOfWeekModeParentChoice, AvailableDays: weekdays, AutoAddTriggerOfferingIDs: []int64{care}},
	}
	for name, tc := range map[string]struct {
		history     []*careplan.BookedOffering
		before      []int // indexes into history: the bookings in effect
		replacement []*careplan.BookedOffering
		want        map[int64]*calendar.Date
	}{
		"an extended offering ends with the phase, the others keep their ends": {
			history: []*careplan.BookedOffering{stored(care, august, march), stored(other, august, may)}, before: []int{0, 1},
			replacement: []*careplan.BookedOffering{manual(care), manual(other)},
			want:        map[int64]*calendar.Date{care: nil, other: &may},
		},
		"a continuation scheduled after today leaves nothing to extend": {
			history: []*careplan.BookedOffering{stored(care, august, march), stored(care, march, may)}, before: []int{0},
			replacement: []*careplan.BookedOffering{manual(care)},
			want:        map[int64]*calendar.Date{care: &march},
		},
		"a change scheduled after today bounds the extension": {
			history: []*careplan.BookedOffering{stored(care, august, march), stored(other, may, may.AddDays(30))}, before: []int{0},
			replacement: []*careplan.BookedOffering{manual(care)},
			want:        map[int64]*calendar.Date{care: &may},
		},
		"a co-booking ends with an extended trigger at a scheduled change": {
			history: []*careplan.BookedOffering{stored(care, august, march), stored(late, august, march), stored(other, may, may.AddDays(30))},
			before:  []int{0, 1},
			replacement: []*careplan.BookedOffering{manual(care),
				{CareOfferingID: late, SelectedDays: []string{"mon"}, AutomaticSelectedDays: []string{"mon"}}},
			want: map[int64]*calendar.Date{care: &may, late: &may},
		},
		"a co-booking goes on with an extended trigger": {
			history: []*careplan.BookedOffering{stored(care, august, march), stored(late, august, march)}, before: []int{0, 1},
			replacement: []*careplan.BookedOffering{manual(care),
				{CareOfferingID: late, SelectedDays: []string{"mon"}, AutomaticSelectedDays: []string{"mon"}}},
			want: map[int64]*calendar.Date{care: nil, late: nil},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			work := &offeringAdjustmentWork{
				selectionDate: calendar.NewDate(2027, 1, 4),
				input:         careplan.OfferingAdjustment{Offerings: []careplan.OfferingAdjustmentChoice{{OfferingID: care, ExtendToPhaseEnd: true}}},
				phase:         ports.BookingPhase{OfferingPhase: careplan.OfferingPhase{ServiceEnd: calendar.NewDate(2027, 7, 31)}},
				replacement:   tc.replacement,
				offeringByID:  offerings,
			}
			for _, i := range tc.before {
				work.beforeLinks = append(work.beforeLinks, tc.history[i])
			}

			kept := keepUnextendedBookingEnds(work, tc.history)

			got := map[int64]*calendar.Date{}
			for _, row := range tc.replacement {
				got[row.CareOfferingID] = row.ValidUntil
			}
			assert.Equal(t, tc.want, got)
			assert.Contains(t, kept, int64(care), "the history still sees the extended booking's end")
		})
	}
}
