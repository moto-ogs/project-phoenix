package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
)

// NewAdministration binds administrative commands to the native fleet.
func NewAdministration(fleet devicefleet.Capability, now func() time.Time) devicefleet.Administration {
	return devicefleet.NewAdministration(fleet, now)
}
