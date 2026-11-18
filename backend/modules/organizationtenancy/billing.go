package organizationtenancy

import (
	"context"
	"errors"
	"time"
)

// BillingReport is the operator billing report (#2791). Billing counts the
// actively managed children and the active terminals of every school on one
// key date per month: the day of every school, unless the operator gave the
// school or its Träger an own day (#7301). The figures of a month are captured once, on the key
// date, and never change afterwards: the live tables cannot answer for a
// past date, because resuming care rewrites the enrollment dates, a hard
// delete removes the student row and devices keep no status history.
//
// What counts is decided by the owners: School Membership counts a live
// membership in status active, Device Fleet a live, non-virtual device in
// status active. Every call runs in the administrative transaction.
type BillingReport interface {
	// BillingKeyDay reads the key day that applies to every school without
	// an own day, and the own days of Träger and schools (#7301).
	BillingKeyDay(ctx context.Context) (BillingKeyDay, error)
	// SetBillingKeyDay changes the key day of every school, or with a
	// target the own key day of a Träger or a school (#7301); an own day nil
	// hands it back to the next level: a school to its Träger, a Träger to
	// the day of every school. A school's day wins over its Träger's. A
	// change applies from the next capture on; a month already captured
	// keeps its key date. A Träger or school that is unknown or deleted is
	// ErrOrganizationNotFound or ErrSchoolNotFound. It returns the key day as
	// BillingKeyDay does.
	SetBillingKeyDay(ctx context.Context, change BillingKeyDayChange, operatorID int64) (BillingKeyDay, error)
	// ListBillingKeyDateCounts returns every captured row, newest month
	// first.
	ListBillingKeyDateCounts(ctx context.Context) ([]BillingKeyDateCount, error)
	// RecordDueBillingKeyDates captures the current month's figures when its
	// key date is due at now and a school has no row yet. It is idempotent
	// and returns the number of rows written.
	RecordDueBillingKeyDates(ctx context.Context, now time.Time) (int, error)
	// SeedBillingKeyDateCounts writes a synthetic current-day snapshot for the
	// local demo seeder. The inbound route keeps this unavailable outside local
	// seed environments; production captures remain worker-only.
	SeedBillingKeyDateCounts(ctx context.Context, now time.Time) (int, error)
}

// ErrInvalidBillingKeyDay rejects a key day outside 1..28. The key day stops
// at 28 so every month has it.
var ErrInvalidBillingKeyDay = errors.New("billing key day must be between 1 and 28")

// BillingKeyDay is the key day of every school, the next key date
// (YYYY-MM-DD) it produces, and the own days of Träger and schools whose
// contract names another day (#7301), Träger before their schools.
type BillingKeyDay struct {
	Day                 int
	NextKeyDate         string
	UpdatedAt           time.Time
	UpdatedByOperatorID *int64
	Overrides           []BillingKeyDayOverride
}

// BillingKeyDayChange is what an operator sets: without Target the key day
// of every school, with Target the own day of that Träger or school. Day nil
// is valid only with a Target and resets its own day.
type BillingKeyDayChange struct {
	Target *BillingKeyDayTarget
	Day    *int
}

// StandardBillingKeyDay changes the key day of every school.
func StandardBillingKeyDay(day int) BillingKeyDayChange {
	return BillingKeyDayChange{Day: &day}
}

// OwnBillingKeyDay sets (day not nil) or resets (day nil) the own key day of
// a Träger or a school.
func OwnBillingKeyDay(target BillingKeyDayTarget, day *int) BillingKeyDayChange {
	return BillingKeyDayChange{Target: &target, Day: day}
}

// BillingKeyDayTarget names whose own key day the operator sets: the Träger
// ID, or with School the school ID.
type BillingKeyDayTarget struct {
	ID     int64
	School bool
}

// BillingKeyDayOverride is the own key day of one Träger or one school
// (#7301). Exactly one of OrganizationID and SchoolID is set; TraegerID and
// OrganizationName name a school's Träger (for a Träger, TraegerID is its own
// ID and OrganizationName is empty). NextKeyDate (YYYY-MM-DD) is the next key
// date the day produces.
type BillingKeyDayOverride struct {
	OrganizationID   *int64
	SchoolID         *int64
	TraegerID        int64
	Name             string
	OrganizationName string
	Day              int
	NextKeyDate      string
	UpdatedAt        time.Time
}

// BillingKeyDateCount is one school's captured figures of one month. The
// names are those the school and its organisation had on capture, so a
// later rename does not change an issued invoice. Period (the month's first
// day) and KeyDate are calendar days as YYYY-MM-DD. RecordedAt is on the
// Berlin clock; a day later than KeyDate means the capture ran late.
type BillingKeyDateCount struct {
	SchoolID         int64
	SchoolName       string
	OrganizationName string
	Period           string
	KeyDate          string
	ActiveStudents   int
	ActiveTerminals  int
	RecordedAt       time.Time
}
