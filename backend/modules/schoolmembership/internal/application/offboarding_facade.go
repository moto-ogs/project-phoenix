package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func NewOffboardingFacade(service *Service) *schoolmembership.Offboarding {
	offboarding := schoolmembership.NewOffboarding(service.PreviewRetirement, service.RetireStaff, service.EraseNextRetiredStaff,
		schoolmembership.Reinstatement{Staff: service.ReinstateStaff, Teacher: service.ReinstateTeacher})
	offboarding.PlannedExits, offboarding.RetirementDay = NewPlannedExitsFacade(service), retirementDay(service)
	return offboarding
}

// retirementDay is the Berlin day of the database clock, which stamps the
// retirement and guards the window of the erasure function (ADR 0281 point
// 3). It joins the caller's tenant transaction.
func retirementDay(service *Service) func(context.Context) (calendar.Date, error) {
	return func(ctx context.Context) (day calendar.Date, err error) {
		err = service.runRead(ctx, "retirement_day", func(txCtx context.Context, stats *domain.OperationStats) error {
			now, err := service.store.DatabaseTime(txCtx)
			stats.Queries++
			day = calendar.DateFromTime(now)
			return err
		})
		return day, err
	}
}
