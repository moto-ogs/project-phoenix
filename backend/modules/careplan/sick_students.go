package careplan

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SickStudents answers the Träger's view of a school (#5686): the two marks of
// a sick child, by the rule of the school's own dashboard. A child counts with
// either of them; the caller decides which children it counts at all. Each map
// is keyed by school and carries IDs only.
//
// The caller must run them in the administrative transaction; they read only
// the given schools.
type SickStudents interface {
	// SickDayStudentIDsByTenant lists the children with an uncleared sick day.
	SickDayStudentIDsByTenant(ctx context.Context, schools []int64, at time.Time) (map[int64][]int64, error)
	// SickFlagMembershipIDsByTenant lists the memberships with the live sick flag.
	SickFlagMembershipIDsByTenant(ctx context.Context, schools []int64) (map[int64][]int64, error)
	// StatusDayCountsByTenant counts, for the Träger's key-date report
	// (#4716, ADR 0246), the children with a sick and with an excused status
	// day that stands for the day, per school and weekday of the window (both
	// days included): one per child and day, sick before excused.
	StatusDayCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (sick, excused map[int64]map[calendar.Date]int, err error)
	// StatusDaysByTenant lists the status days that stand for their day
	// between from and to, both included, one per child and day (#4717).
	StatusDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]StatusDay, error)
}

// The statuses of a StatusDay.
const (
	StatusDaySick      = "sick"
	StatusDayExcused   = "excused"
	StatusDayClassTrip = "class_trip"
)

// StatusDay is a child's reported absence on one day at one school: sick,
// excused or on a class trip. It stands for the day as on the school's own
// dashboard: active, or archived at the day's end. Where a child has several,
// sick wins over excused, excused over class trip.
type StatusDay struct {
	SchoolID  int64
	Date      calendar.Date
	StudentID int64
	Status    string
}
