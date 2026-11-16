package timetracking

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type OverviewStaff struct {
	ID                 int64
	FirstName          string
	LastName           string
	EmploymentType     *string
	PersonnelNumber    *string
	WorkTimeModelID    *int64
	RotationAnchorDate *calendar.Date
	// ExternalCaregiver marks an external caregiver (#3823), who records no
	// working time; the overview leaves them out.
	ExternalCaregiver bool
}

// OverviewStaffQuery selects the tenant's non-offboarded staff for reports.
// FindOverviewStaff resolves the given employments, offboarded ones
// included: a month that is billed after the person left still has to
// reach the payroll file (#4712).
type OverviewStaffQuery interface {
	ListOverviewStaff(context.Context) ([]OverviewStaff, error)
	FindOverviewStaff(ctx context.Context, ids []int64) ([]OverviewStaff, error)
}
