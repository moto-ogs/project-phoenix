package enrollment

import (
	"context"
	"errors"
)

// ErrSchoolExtraDayForeignSchool reports an extra day a school plans for
// another school than its own.
var ErrSchoolExtraDayForeignSchool = errors.New("a school plans an extra day for itself only")

// SchoolExtraDays lets a school plan extra care days for itself (#4817,
// ADR 0329): a holiday period of the kind HolidayPeriodKindExtraDay whose
// only host is the school. The rows belong to the Träger of the school;
// every operation runs in the Träger transaction of organizationID, which
// the caller opens after it read the Träger of the session's school. The
// school reads and changes only the days it created itself while they are
// its own alone: a day of the Träger-Büro, of another school or of another
// Träger is ErrHolidayPeriodNotFound. Places, registrations and the billing
// stay with the Träger-Büro.
type SchoolExtraDays interface {
	ListSchoolExtraDays(ctx context.Context, organizationID, schoolID int64) ([]HolidayPeriod, error)
	SchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64) (HolidayPeriod, error)
	// CreateSchoolExtraDay adds a draft extra day hosted by schoolID alone;
	// a week of another school is ErrSchoolExtraDayForeignSchool.
	CreateSchoolExtraDay(ctx context.Context, organizationID, schoolID int64, input HolidayPeriodInput) (HolidayPeriod, error)
	UpdateSchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64, input HolidayPeriodInput) (HolidayPeriod, error)
	PublishSchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64) (HolidayPeriod, error)
}

// HolidayHostTraeger names the Träger of a school. The root binds it to Organisation & Tenancy; it reads in the tenant
// transaction of the school.
type HolidayHostTraeger interface {
	HolidayHostTraeger(ctx context.Context, schoolID int64) (int64, error)
}
