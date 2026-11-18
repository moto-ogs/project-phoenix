package owners

import (
	"context"
	"errors"
	"time"

	organizationModule "github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// schedulerTenantDirectory lists the tenant IDs the worker iterates and
// captures the billing key-date counts (#2791), both owned by Organisation &
// Tenancy.
type schedulerTenantDirectory struct {
	schools     organizationModule.Query
	billing     organizationModule.BillingReport
	schoolNames SchoolNamesPublisher
}

// SchoolNamesPublisher names schools in the product analytics so the usage
// dashboards show school names; the API root binds it to the tracker. It
// returns the schools named.
type SchoolNamesPublisher func(schools []organizationModule.School) int

func (d schedulerTenantDirectory) RecordDueBillingKeyDates(ctx context.Context, now time.Time) (int, error) {
	if d.billing == nil {
		return 0, errors.New("billing report is not composed")
	}
	return d.billing.RecordDueBillingKeyDates(ctx, now)
}

// PublishSchoolNames names every non-deleted school in the product analytics
// (the usage dashboards).
func (d schedulerTenantDirectory) PublishSchoolNames(ctx context.Context) (int, error) {
	if d.schoolNames == nil {
		return 0, errors.New("school names publisher is not composed")
	}
	schools, err := d.schools.ListNonDeletedSchools(ctx)
	if err != nil {
		return 0, err
	}
	return d.schoolNames(schools), nil
}

// HoldLiveSchool holds the school of the running tenant transaction under a
// share lock (#6305, #7478) and reports whether it is active and not deleted.
func (d schedulerTenantDirectory) HoldLiveSchool(ctx context.Context, tenantID int64) (bool, error) {
	school, found, err := lookupSchoolForShare(ctx, d.schools, tenantID)
	return found && school.Active && !school.IsDeleted(), err
}

func (d schedulerTenantDirectory) ListActiveTenantIDs(ctx context.Context) ([]int64, error) {
	schools, err := d.schools.ListActiveSchools(ctx)
	return schoolIDs(schools), err
}

func (d schedulerTenantDirectory) ListCleanupTenantIDs(ctx context.Context) ([]int64, error) {
	schools, err := d.schools.ListSchools(ctx)
	return schoolIDs(schools), err
}

func schoolIDs(schools []organizationModule.School) []int64 {
	ids := make([]int64, 0, len(schools))
	for _, school := range schools {
		ids = append(ids, school.ID)
	}
	return ids
}
