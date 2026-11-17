package compose

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/application"
	carePlanPorts "github.com/moto-ogs/project-phoenix/modules/careplan/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func NewPickupBaselines(records carePlanPorts.PickupBaselineRecords, links careplan.ApprovedBookingReader, authoritative func(context.Context) (bool, error), today func() calendar.Date) (careplan.PickupBaselineReader, error) {
	if records == nil || links == nil || authoritative == nil || today == nil {
		return nil, errors.New("pickup baselines: records, approved bookings, booking mode, and clock are required")
	}
	return application.NewPickupBaselines(records, links, authoritative, today), nil
}
