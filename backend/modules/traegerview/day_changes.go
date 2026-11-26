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
// It reads the closing days of the school and of the Träger, the number of
// cancelled blocks (#7672), the changed opening hours (#7654), a cancelled
// lunch (#7656) and the number of closed rooms (#7653, #8146). The new kinds
// carry no reason and no room name. The shortage of staff stays among the
// hints (AlertStaffShortage).

// SchoolDayClosing is one closing day that closes the school today. Since
// and Until are set only when the closing reaches past today.
type SchoolDayClosing struct {
	Name    string         `json:"name"`
	Traeger bool           `json:"traeger"`
	Since   *calendar.Date `json:"since"`
	Until   *calendar.Date `json:"until"`
}

// SchoolDayOpening is one change of the opening hours of the school today
// (#8146), with the hours ("15:04") and no reason. Since and Until are set
// only when the change reaches past today.
type SchoolDayOpening struct {
	OpensAt  string         `json:"opens_at"`
	ClosesAt string         `json:"closes_at"`
	Since    *calendar.Date `json:"since"`
	Until    *calendar.Date `json:"until"`
}

// SchoolDayChanges is one school of the Träger with its changes today.
type SchoolDayChanges struct {
	TraegerSchool
	ClosingDays     []SchoolDayClosing `json:"closing_days"`
	CancelledBlocks int                `json:"cancelled_blocks"`
	// OpeningChanges are today's changed opening hours (#8146).
	OpeningChanges []SchoolDayOpening `json:"opening_changes"`
	// MealCancelled reports that lunch does not take place today (#8146).
	MealCancelled bool `json:"meal_cancelled"`
	// ClosedRooms counts the rooms a closure closes today (#8146).
	ClosedRooms int `json:"closed_rooms"`
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

// DayChangePorts are the owners' reads behind "Heute anders". Schools reads
// the Träger's schools with their names in one statement at Organisation &
// Tenancy; every other port joins the projection's administrative
// transaction and reads only the given schools.
type DayChangePorts struct {
	Schools DayChangeSchools
	Days    SchoolCalendarDays
	Blocks  CancelledBlocks
	Meals   MealCancellations
	Rooms   ClosedRooms
}

// DayChangeSchools reads the undeleted schools of an active, undeleted
// Träger with their names, ordered by name, in one statement. Any other
// Träger answers ErrTraegerUnavailable.
type DayChangeSchools interface {
	TraegerSchoolsWithNames(ctx context.Context, organizationID int64) ([]TraegerSchool, error)
}

// SchoolClosingDay is one closing day of a school on the day, at School
// Calendar.
type SchoolClosingDay struct {
	StartDate calendar.Date
	EndDate   calendar.Date
	Name      string
	Traeger   bool
}

// SchoolOpeningChange is one change of the opening hours of a school on the
// day, at School Calendar, without its reason.
type SchoolOpeningChange struct {
	StartDate calendar.Date
	EndDate   calendar.Date
	OpensAt   string
	ClosesAt  string
}

// SchoolCalendarDay is what School Calendar changes on the day of a school.
type SchoolCalendarDay struct {
	Closings []SchoolClosingDay
	Openings []SchoolOpeningChange
}

// SchoolCalendarDays reads the closing days and the opening changes of the
// schools on day in one statement, keyed by school: the schools' own and
// the closing days organizationID planned for them.
type SchoolCalendarDays interface {
	SchoolCalendarDaysOn(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) (map[int64]SchoolCalendarDay, error)
}

// CancelledBlocks counts the cancelled blocks of the schools on day, keyed
// by school, at Timetable.
type CancelledBlocks interface {
	CancelledBlocksByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error)
}

// MealCancellations reads the schools that cancelled lunch on day, at Meal
// Plan.
type MealCancellations interface {
	MealCancelledSchools(ctx context.Context, schools []int64, day calendar.Date) (map[int64]bool, error)
}

// ClosedRooms counts the closed rooms of the schools on day, keyed by
// school, at Facilities.
type ClosedRooms interface {
	ClosedRoomsByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error)
}
