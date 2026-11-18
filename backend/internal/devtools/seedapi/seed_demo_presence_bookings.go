package api

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type demoPresenceBooking struct {
	StudentID int64         `json:"student_id"`
	Date      calendar.Date `json:"date"`
	Expected  bool          `json:"expected"`
	NoPlan    bool          `json:"no_plan"`
	Cancelled bool          `json:"cancelled"`
	Arrival   *int          `json:"arrival_minute"`
	Pickup    *int          `json:"pickup_minute"`
}

// loadDemoPresenceBookings reads the effective care plan once for the whole
// school. The same booking and contract precedence drives the Träger report.
func loadDemoPresenceBookings(rt *Runtime, input *presenceHistoryInput) error {
	path := fmt.Sprintf("/operator/schools/%d/demo-presence-history?from=%s&to=%s",
		rt.Bootstrap.SchoolID, input.from, input.today.AddDays(-1))
	raw, err := rt.Client.GetWithAuth(rt.OperatorAuth, path)
	if err != nil {
		return fmt.Errorf("read effective bookings for the demo history: %w", err)
	}
	var response struct {
		Data []demoPresenceBooking `json:"data"`
	}
	if err := parseJSON(raw, &response); err != nil {
		return fmt.Errorf("decode effective bookings for the demo history: %w", err)
	}
	input.bookings = make(map[calendar.Date]map[int64]demoPresenceBooking)
	for _, booking := range response.Data {
		if input.bookings[booking.Date] == nil {
			input.bookings[booking.Date] = make(map[int64]demoPresenceBooking)
		}
		input.bookings[booking.Date][booking.StudentID] = booking
	}
	return nil
}

// selectUnbookedDemoDays picks at most two recent visits on distinct days
// when care was available but the child had no booking. Unknown plans and
// cancellations stay out of the examples.
func selectUnbookedDemoDays(input presenceHistoryInput, from calendar.Date) map[calendar.Date]int64 {
	if input.unbookedExamples == 0 {
		return nil
	}
	examples := make(map[calendar.Date]int64, input.unbookedExamples)
	for day := input.today.AddDays(-1); !day.Before(from) && len(examples) < input.unbookedExamples; day = day.AddDays(-1) {
		if calendar.IsWeekend(day) || !input.careDays(day) {
			continue
		}
		for _, student := range input.students {
			booking, ok := input.bookings[day][student.id]
			ended := student.lastDay != nil && day.After(*student.lastDay)
			if ok && !ended && !booking.Expected && !booking.NoPlan && !booking.Cancelled {
				examples[day] = student.id
				break
			}
		}
	}
	return examples
}

func historyPresenceTimes(input presenceHistoryInput, index int, studentID int64, day calendar.Date) (arrival, pickup int, expected bool) {
	if input.bookings == nil {
		arrival, pickup = presenceTimes(index, day)
		return arrival, pickup, true
	}
	booking := input.bookings[day][studentID]
	if !booking.Expected || booking.Cancelled {
		return 0, 0, false
	}
	arrival, pickup = 12*60+30, 15*60+15
	if booking.Arrival != nil {
		arrival = *booking.Arrival
	}
	if booking.Pickup != nil {
		pickup = *booking.Pickup
		if booking.Arrival == nil && pickup <= arrival {
			arrival = max(0, pickup-60)
		}
	} else if pickup <= arrival {
		pickup = min(24*60-1, arrival+60)
	}
	if pickup <= arrival {
		return 0, 0, false
	}

	window := pickup - arrival
	roll := presenceRoll(index, day, "booked-overrun") % 1000
	// Most arrivals and departures fit the booking. A few children arrive
	// early or leave late by 20–45 minutes, enough to show a real overrun.
	arrivalJitter := min(window/4, int(presenceRoll(index, day, "booked-in")%10))
	pickupJitter := min(window/4, int(presenceRoll(index, day, "booked-out")%13))
	if roll < 9 && booking.Arrival != nil {
		return max(0, arrival-20-int(roll)*3), pickup - pickupJitter, true
	}
	if roll >= 9 && roll < 18 && booking.Pickup != nil {
		return arrival + arrivalJitter, min(24*60-1, pickup+20+int(roll-9)*3), true
	}
	return arrival + arrivalJitter, pickup - pickupJitter, true
}
