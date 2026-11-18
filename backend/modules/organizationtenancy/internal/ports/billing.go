package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
)

// BillingStore keeps the billing key day and the captured counts (#2791).
// Every call runs on the caller's administrative transaction.
type BillingStore interface {
	// UseRepeatableReadSnapshot makes the capture's school and owner reads see
	// one database snapshot before any of those reads begin.
	UseRepeatableReadSnapshot(context.Context) error
	// UseReadCommitted lets the insert's ON CONFLICT DO NOTHING skip a row
	// another capture committed after this one listed the schools; under a
	// repeatable-read snapshot that row fails the capture with 40001.
	UseReadCommitted(context.Context) error
	BillingSettings(context.Context) (domain.BillingSettings, error)
	UpdateBillingKeyDay(ctx context.Context, keyDay int, operatorID int64) (domain.BillingSettings, error)
	// SchoolsMissingBillingPeriod lists the non-deleted schools created by
	// the end of the month that starts on period (YYYY-MM-01) and have no
	// captured row for it yet, with the levels of their key day (#7301).
	SchoolsMissingBillingPeriod(ctx context.Context, period string) ([]domain.BillingSchool, error)
	// InsertBillingKeyDateCounts writes the rows and skips a school whose
	// month is already captured. It returns the number of rows written.
	InsertBillingKeyDateCounts(ctx context.Context, counts []domain.BillingKeyDateCount) (int, error)
	ListBillingKeyDateCounts(context.Context) ([]domain.BillingKeyDateCount, error)
	// ListBillingKeyDayOverrides lists every live Träger and school with an
	// own key day (#7301).
	ListBillingKeyDayOverrides(context.Context) ([]domain.BillingKeyDayOverride, error)
	// SetBillingKeyDayOverride sets (day not nil) or resets (day nil) the own
	// key day of a Träger or school and reports whether it is live.
	SetBillingKeyDayOverride(ctx context.Context, target domain.BillingKeyDayTarget, day *int, operatorID int64) (bool, error)
}

// BillingCounts are the live figures of every school, each answered by its
// owner: School Membership for active students, Device Fleet for active
// terminals. A school missing from a map has none.
type BillingCounts interface {
	CountActiveStudentsByTenant(context.Context, time.Time) (map[int64]int, error)
	CountActiveTerminalsByTenant(context.Context) (map[int64]int, error)
}

// BillingClock supplies the current instant.
type BillingClock func() time.Time
