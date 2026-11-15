package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ParentLetterStudent is the directory data a letter needs for one child.
type ParentLetterStudent struct {
	ID          int64
	SchoolClass string
	GroupID     *int64
}

type ParentLetterStudentName struct {
	StudentID int64
	FirstName string
	LastName  string
}

// ParentLetterStudents reads the whole set in the caller's tenant transaction;
// children outside that school are absent.
type ParentLetterStudents interface {
	ListStudentsByID(context.Context, []int64) ([]ParentLetterStudent, error)
	ListStudentNamesByID(context.Context, []int64) ([]ParentLetterStudentName, error)
}

type ParentLetterPickup struct {
	StudentID  int64
	Weekday    int
	PickupTime time.Time
}

type ParentLetterArrival struct {
	StudentID int64
	Weekday   int
}

// ParentLetterPickups and ParentLetterArrivals read the effective weekly
// plans for the whole set, in the caller's tenant transaction.
type ParentLetterPickups interface {
	GetWeeklySchedulesByStudentIDsForDate(context.Context, []int64, calendar.Date) ([]*ParentLetterPickup, error)
}

type ParentLetterArrivals interface {
	GetWeeklySchedulesByStudentIDsForDate(context.Context, []int64, calendar.Date) ([]*ParentLetterArrival, error)
}

// ParentLetterSources supplies the tenant-scoped facts, not their letter
// formatting or care-week derivation, to Communication.
type ParentLetterSources struct {
	Students ParentLetterStudents
	Groups   GroupNames
	Pickups  ParentLetterPickups
	Arrivals ParentLetterArrivals
}
