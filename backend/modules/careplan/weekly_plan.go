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
	return readstate.Fingerprint(struct {
		Arrivals []weeklyPlanRow `json:"arrivals"`
		Pickups  []weeklyPlanRow `json:"pickups"`
		Notes    []weeklyPlanRow `json:"notes"`
	}{weeklyArrivalRows(arrivals), weeklyPickupRows(pickups), weeklyNoteRows(notes)})
}

// weeklyPlanRow is one stored row of the weekly plan in canonical form.
type weeklyPlanRow struct {
	Weekday  int    `json:"weekday"`
	Time     string `json:"time"`
	Text     string `json:"text"`
	Source   string `json:"source"`
	Origin   string `json:"origin"`
	Offering int64  `json:"offering"`
}

func weeklyArrivalRows(arrivals []ArrivalSchedule) []weeklyPlanRow {
	rows := make([]weeklyPlanRow, 0, len(arrivals))
	for _, row := range arrivals {
		arrival := ""
		if !row.ExpectedArrival.IsZero() {
			arrival = row.ExpectedArrival.Format("15:04:05")
		}
		rows = append(rows, weeklyPlanRow{Weekday: row.Weekday, Time: arrival, Text: textOf(row.Notes), Source: row.Source, Origin: row.SourceClass})
	}
	return sortedWeeklyPlanRows(rows)
}

func weeklyPickupRows(pickups []PickupSchedule) []weeklyPlanRow {
	rows := make([]weeklyPlanRow, 0, len(pickups))
	for _, row := range pickups {
		var offering int64
		if row.CareOfferingID != nil {
			offering = *row.CareOfferingID
		}
		rows = append(rows, weeklyPlanRow{Weekday: row.Weekday, Time: row.PickupTime.Format("15:04:05"), Text: textOf(row.Notes), Source: row.Source, Offering: offering})
	}
	return sortedWeeklyPlanRows(rows)
}

func weeklyNoteRows(notes []PickupNote) []weeklyPlanRow {
	rows := make([]weeklyPlanRow, 0, len(notes))
	for _, note := range notes {
		if note.Weekday != 0 {
			rows = append(rows, weeklyPlanRow{Weekday: note.Weekday, Text: note.Content})
		}
	}
	return sortedWeeklyPlanRows(rows)
}

// sortedWeeklyPlanRows orders the rows independently of how they were read.
func sortedWeeklyPlanRows(rows []weeklyPlanRow) []weeklyPlanRow {
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.Weekday != b.Weekday {
			return a.Weekday < b.Weekday
		}
		return a.Source+"\x00"+a.Time+"\x00"+a.Text < b.Source+"\x00"+b.Time+"\x00"+b.Text
	})
	return rows
}

func textOf(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
