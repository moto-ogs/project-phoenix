package compose

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

type transaction struct{}

func (transaction) Run(ctx context.Context, callback func(context.Context) error) error {
	return tenant.NewTransactionRunner().RunInTx(ctx, callback)
}

type Observation = ports.Observation
type OrderingSettings = ports.OrderingSettings // the school's meal ordering settings as stored

type Dependencies struct {
	DB       *bun.DB
	Settings interface {
		MealPlanEnabled(context.Context) (bool, error)
		MealRegistrationEnabled(context.Context) (bool, error)
		MealOrderingSettings(context.Context) (OrderingSettings, error)
	}
	Observe         func(Observation)
	Now             func() time.Time
	Participants    mealplan.ParticipantFinder
	ParticipantDays mealplan.ParticipantDaysFinder
	StudentNames    mealplan.StudentNameFinder
	LockStudent     mealplan.StudentLock
	Calendar        mealplan.CalendarFinder
	Notices         mealplan.MenuChangeNotices // changed menu to the families (#7145); nil in the worker, which never changes it
}

// Plan exposes the compact projection separately from the existing school facade.
type Plan struct {
	Capability mealplan.Capability
	Summaries  mealplan.CatererSummaries
}

func New(dependencies Dependencies) (Plan, error) {
	if dependencies.DB == nil || dependencies.Settings == nil || dependencies.Observe == nil || dependencies.Now == nil || dependencies.Participants == nil || dependencies.ParticipantDays == nil || dependencies.StudentNames == nil || dependencies.LockStudent == nil || dependencies.Calendar == nil {
		return Plan{}, errors.New("meal plan compose: all dependencies are required")
	}
	service := application.New(postgres.New(postgres.NewDatabase(tenant.TransactionFromContext, tenant.TenantFromContext)), application.NewParticipantDirectory(dependencies.Participants, dependencies.StudentNames, dependencies.ParticipantDays, dependencies.LockStudent), application.NewSchoolCalendar(dependencies.Calendar), dependencies.Settings, transaction{}, dependencies.Observe, dependencies.Now, dependencies.Notices)
	return Plan{Capability: service, Summaries: service}, nil
}

type Settings = application.Settings // the application-owned bound resolvers

func NewBoundSettings(mealPlanEnabled, mealRegistrationEnabled func(context.Context) (bool, error), orderingSettings func(context.Context) (OrderingSettings, error)) (*Settings, error) {
	return application.NewBoundSettings(mealPlanEnabled, mealRegistrationEnabled, orderingSettings)
}

// NewMenuChanges reads the change mark of a day (#7666) in the caller's tenant transaction.
func NewMenuChanges() mealplan.MenuChanges {
	return postgres.NewMenuChanges(postgres.NewDatabase(tenant.TransactionFromContext, tenant.TenantFromContext))
}
