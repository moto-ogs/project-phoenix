package compose

import (
	"time"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/application"
	delivery "github.com/moto-ogs/project-phoenix/modules/delivery/runtime"
)

// NewRetention binds the school's nightly cleanup (#3955) to its tenant transaction and clock.
func NewRetention(now func() time.Time) deliveryContract.Retention {
	return application.NewRetention(postgres.New(postgres.RequireTenantDatabase, postgres.RequireAdminDatabase, now), now)
}

// NewHolidayRegistrationMailErasure needs only the caller's admin transaction.
func NewHolidayRegistrationMailErasure() delivery.HolidayRegistrationMailErasure {
	return postgres.New(postgres.RequireTenantDatabase, postgres.RequireAdminDatabase, time.Now)
}
