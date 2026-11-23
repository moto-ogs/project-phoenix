package careplan

import (
	"context"
	"sort"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The weekly plan of a child is what the Betreuungsplan editor shows and
// saves as one form: the weekly arrival rows, the weekly pickup rows and the
// notes that recur on a weekday. One save writes all three, so one read-state
// token covers them (ADR 0311).

// WeeklyPlans reads the token of a child's weekly plan and saves the weekly
// arrival plan and the weekday notes as one command. A pickup change goes
// through the pickup adjustment, which checks the same token.
type WeeklyPlans interface {
	WeeklyPlanVersion(ctx context.Context, studentID int64) (string, error)
	SaveWeeklyPlan(ctx context.Context, input WeeklyPlanInput) (string, error)
}

// WeeklyPlanInput changes the weekly plan read at ExpectedVersion.
// ArrivalSchedules replaces the weekly arrival plan and WeekdayNotes the
// recurring weekday notes, both in one unit; nil leaves either as it is.
type WeeklyPlanInput struct {
	StudentID        int64
	ArrivalSchedules *[]*ArrivalSchedule
	WeekdayNotes     map[int]string
	CreatedByStaffID int64
	ExpectedVersion  string
}

// WeeklyPlanVersion is the read-state token of a child's stored weekly plan:
// every weekly arrival and pickup row with the values the editor shows, and
// the weekday notes. Dated notes belong to single days and stay outside.
func WeeklyPlanVersion(arrivals []ArrivalSchedule, pickups []PickupSchedule, notes []PickupNote) string {
	type arrivalRow struct {
		Weekday int    `json:"weekday"`
		Arrival string `json:"arrival"`
		Notes   string `json:"notes"`
		Source  string `json:"source"`
		Class   string `json:"class"`
	}
	type pickupRow struct {
		Weekday  int    `json:"weekday"`
		Pickup   string `json:"pickup"`
		Notes    string `json:"notes"`
		Source   string `json:"source"`
		Offering int64  `json:"offering"`
	}
	type noteRow struct {
		Weekday int    `json:"weekday"`
		Content string `json:"content"`
	}
	state := struct {
		Arrivals []arrivalRow `json:"arrivals"`
		Pickups  []pickupRow  `json:"pickups"`
		Notes    []noteRow    `json:"notes"`
	}{Arrivals: []arrivalRow{}, Pickups: []pickupRow{}, Notes: []noteRow{}}
	for _, row := range arrivals {
		arrival := ""
		if !row.ExpectedArrival.IsZero() {
			arrival = row.ExpectedArrival.Format("15:04:05")
		}
		state.Arrivals = append(state.Arrivals, arrivalRow{row.Weekday, arrival, textOf(row.Notes), row.Source, row.SourceClass})
	}
	for _, row := range pickups {
		var offering int64
		if row.CareOfferingID != nil {
			offering = *row.CareOfferingID
		}
		state.Pickups = append(state.Pickups, pickupRow{row.Weekday, row.PickupTime.Format("15:04:05"), textOf(row.Notes), row.Source, offering})
	}
	for _, note := range notes {
		if note.Weekday != 0 {
			state.Notes = append(state.Notes, noteRow{note.Weekday, note.Content})
		}
	}
	sort.Slice(state.Arrivals, func(i, j int) bool {
		a, b := state.Arrivals[i], state.Arrivals[j]
		if a.Weekday != b.Weekday {
			return a.Weekday < b.Weekday
		}
		return a.Source+"\x00"+a.Arrival+"\x00"+a.Notes < b.Source+"\x00"+b.Arrival+"\x00"+b.Notes
	})
	sort.Slice(state.Pickups, func(i, j int) bool {
		a, b := state.Pickups[i], state.Pickups[j]
		if a.Weekday != b.Weekday {
			return a.Weekday < b.Weekday
		}
		return a.Source+"\x00"+a.Pickup+"\x00"+a.Notes < b.Source+"\x00"+b.Pickup+"\x00"+b.Notes
	})
	sort.Slice(state.Notes, func(i, j int) bool {
		if state.Notes[i].Weekday != state.Notes[j].Weekday {
			return state.Notes[i].Weekday < state.Notes[j].Weekday
		}
		return state.Notes[i].Content < state.Notes[j].Content
	})
	return readstate.Fingerprint(state)
}

func textOf(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
