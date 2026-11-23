package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/application"
	"github.com/moto-ogs/project-phoenix/tenant"
)

type PastMealDay = mealplan.PastMealDay

// NewParticipationHistory is the dev CLI's past-registration writer.
func NewParticipationHistory(now func() time.Time) mealplan.ParticipationHistory {
	return application.NewParticipationHistory(postgres.New(postgres.NewDatabase(tenant.TransactionFromContext, tenant.TenantFromContext)), transaction{}, now)
}
