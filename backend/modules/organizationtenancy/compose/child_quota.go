package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/adapters/postgres"
)

// NewChildQuotaLimits composes the tenant-safe read of the Kinderkontingent (#3567) School Membership checks its
// counting writes against, on the caller's tenant transaction for the tenant in context only.
func NewChildQuotaLimits() organizationtenancy.ChildQuotaLimits {
	return postgres.ComposedSchoolLimits{}
}

// NewDeviceSlotLimits composes the same read of the Geräteplätze (#2312) Device Fleet checks a registration against.
func NewDeviceSlotLimits() organizationtenancy.DeviceSlotLimits {
	return postgres.ComposedSchoolLimits{}
}
