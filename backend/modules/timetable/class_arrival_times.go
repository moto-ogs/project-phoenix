package timetable

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ClassArrivalPlan preserves the entered class label and recurring dismissal
// times. Class matching uses trimmed, case-insensitive keys, not the label.
type ClassArrivalPlan struct {
	ID           int64
	TenantID     int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
	SchoolClass  string
	ArrivalTimes map[string]string
	UpdatedBy    *int64
}

// ClassArrivalException is a class-wide dismissal change. Date is the
// timezone-free YYYY-MM-DD value used by Timetable's public contracts.
type ClassArrivalException struct {
	ID          int64
	TenantID    int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
	SchoolClass string
	Date        string
	ArrivalTime time.Time
	Reason      *string
	CreatedBy   *int64
	Origin      string
}

var ErrInvalidClassArrivalExceptionRange = errors.New("invalid class arrival exception date range")

func ValidClassArrivalExceptionDates(from, to string) bool {
	return ValidDate(from) && ValidDate(to)
}

// ValidDate reports whether value is a YYYY-MM-DD calendar date.
func ValidDate(value string) bool {
	_, err := time.Parse(time.DateOnly, value)
	return err == nil
}

// ClassArrivalQuery supplies the recurring dismissal times used by Care Plan.
// Class keys are trimmed and lowercased; weekday keys and HH:MM values retain
// their persisted form. Only requested classes in the current tenant return.
type ClassArrivalQuery interface {
	ListClassArrivalTimes(context.Context, []string) (map[string]map[string]string, error)
	ListClassArrivalPlans(context.Context, []string) ([]ClassArrivalPlan, error)
	ListClassArrivalExceptions(context.Context, []string, string, string) ([]ClassArrivalException, error)
}

// ClassArrivalDayQuery reads the class-wide dismissal changes of every class
// on one day (#7681).
type ClassArrivalDayQuery interface {
	ListClassArrivalExceptionsOn(ctx context.Context, day calendar.Date) ([]ClassArrivalException, error)
}

// ErrNoClassArrivalDay reports a class arrival query without the day read.
var ErrNoClassArrivalDay = errors.New("timetable class arrivals: the query reads no day of every class")

// ClassArrivalDayOf is the day read of the class arrival query the owner
// composed.
func ClassArrivalDayOf(query ClassArrivalQuery) (ClassArrivalDayQuery, error) {
	day, ok := query.(ClassArrivalDayQuery)
	if !ok {
		return nil, ErrNoClassArrivalDay
	}
	return day, nil
}
