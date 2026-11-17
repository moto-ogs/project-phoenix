package owners

import (
	"context"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	delivery "github.com/moto-ogs/project-phoenix/modules/delivery/runtime"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
)

// NewHolidayRegistrationRetention binds mail erasure to the registration's
// existing administrative command on the root's clock now. Failure rolls
// back both owners' changes.
func NewHolidayRegistrationRetention(now func() time.Time) enrollment.HolidayRegistrationRetention {
	return enrollmentCompose.NewHolidayRegistrationRetention(holidayRegistrationMailErasure{deliveryCompose.NewHolidayRegistrationMailErasure()}, now)
}

type holidayRegistrationMailErasure struct {
	delivery.HolidayRegistrationMailErasure
}

func (m holidayRegistrationMailErasure) EraseHolidayRegistrationMails(ctx context.Context, registrations []enrollment.HolidayRegistrationReference) (int, error) {
	organizations, ids := make([]int64, len(registrations)), make([]int64, len(registrations))
	for i, registration := range registrations {
		organizations[i], ids[i] = registration.OrganizationID, registration.RegistrationID
	}
	return m.HolidayRegistrationMailErasure.EraseHolidayRegistrationMails(ctx, organizations, ids)
}
