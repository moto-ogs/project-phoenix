package traegerview

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// "Heute anders" in the Träger-Portal (#7672): the bigger changes to the
// regular day of each school of the Träger, today. The answer carries no
// person, no name of a staff member and no reason of an absence. A closing
// day carries the name the school or the Träger gave it.
//
// v1 reads the closing days of the school and of the Träger and the number
// of cancelled blocks. A shorter opening (#7654), a cancelled lunch (#7656)
// and blocked rooms (#7653) have no data yet and join as their own fields.
// The shortage of staff stays among the hints (AlertStaffShortage).

// SchoolDayClosing is one closing day that closes the school today. Since
// and Until are set only when the closing reaches past today.
type SchoolDayClosing struct {
	Name    string         `json:"name"`
	Traeger bool           `json:"traeger"`
	Since   *calendar.Date `json:"since"`
	Until   *calendar.Date `json:"until"`
}

// SchoolDayChanges is one school of the Träger with its changes today.
type SchoolDayChanges struct {
	TraegerSchool
	ClosingDays     []SchoolDayClosing `json:"closing_days"`
	CancelledBlocks int                `json:"cancelled_blocks"`
}

// SchoolsDayChanges are the schools of the Träger with a change today,
// ordered by name; a school without one is missing. Day is the Berlin day
// of the read.
type SchoolsDayChanges struct {
	Day     calendar.Date      `json:"day"`
	Schools []SchoolDayChanges `json:"schools"`
	AsOf    time.Time          `json:"as_of"`
}

// DayChangesReport answers "Heute anders" of the Träger-Portal.
type DayChangesReport interface {
	// SchoolsDayChanges returns the changes of today of every school of
	// the Träger that has one.
	SchoolsDayChanges(ctx context.Context, organizationID int64) (SchoolsDayChanges, error)
}

// DayChangePorts are the owners' reads behind "Heute anders". Both join
// the projection's administrative transaction and read only the given
// schools.
type DayChangePorts struct {
	Closings SchoolClosingDays
	Blocks   CancelledBlocks
}

// SchoolClosingDay is one closing day of a school on the day, at School
// Calendar.
type SchoolClosingDay struct {
	StartDate calendar.Date
	EndDate   calendar.Date
	Name      string
	Traeger   bool
}

// SchoolClosingDays reads the closing days of the schools on day, keyed by
// school: the schools' own and those organizationID planned for them.
type SchoolClosingDays interface {
	SchoolClosingDaysOn(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) (map[int64][]SchoolClosingDay, error)
}

// CancelledBlocks counts the cancelled blocks of the schools on day, keyed
// by school, at Timetable.
type CancelledBlocks interface {
	CancelledBlocksByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error)
}
