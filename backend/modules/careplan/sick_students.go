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
}
