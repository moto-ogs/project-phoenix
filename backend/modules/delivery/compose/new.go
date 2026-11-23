package compose

import (
	"context"
	"errors"
	"time"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"
	"github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	delivery "github.com/moto-ogs/project-phoenix/modules/delivery/runtime"
	"github.com/uptrace/bun"
)

// ModuleDependencies are the enqueue and state side of Delivery, which the
// producers and Identity & Access need before the mail renderers exist.
type ModuleDependencies struct {
	DB            *bun.DB
	People        GuardianDisplayResolver
	Observe       func(deliveryContract.Observation)
	EmailProvider mail.ProviderConfig
	Now           func() time.Time // clock of the outboxes and mail events; nil is the real one
}

type Runtime application.Runtime
type Provider interface{ application.Provider }
type GuardianDisplayResolver interface{ ports.GuardianDirectory }

func NewWorker(runtime *Runtime, provider Provider) (*delivery.Worker, error) {
	return application.NewWorkerBinding((*application.Runtime)(runtime), provider)
}
func NewPushDispatcher(runtime *Runtime, provider Provider) *delivery.PushDispatcher {
	return application.NewPushDispatcher((*application.Runtime)(runtime), provider)
}
func (r *Runtime) EmailStatus(ctx context.Context, tenantID, id int64) (deliveryContract.State, bool, error) {
	return (*application.Runtime)(r).EmailStatus(ctx, tenantID, id)
}

// NewModule composes enqueue and e-mail state; NewWorker adds the worker once renderers exist.
func NewModule(dependencies ModuleDependencies) (*Runtime, error) {
	if dependencies.DB == nil || dependencies.People == nil || dependencies.Observe == nil {
		return nil, errors.New("delivery compose: all dependencies are required")
	}
	if dependencies.Now == nil {
		dependencies.Now = time.Now
	}
	raw := postgres.New(postgres.RequireTenantDatabase, postgres.RequireAdminDatabase, dependencies.Now)
	store := application.NewWorkerCommands(raw, NewTenantTransactions(dependencies.DB).WithinSystem, NewTenantTransactions(dependencies.DB).WithinTenant)
	observe := application.NewObservationAdapter(dependencies.Observe)
	return (*Runtime)(application.NewRuntime(application.NewService(store, dependencies.People, observe, dependencies.Now), store, observe, postgres.EmailWakeups(dependencies.DB), dependencies.EmailProvider, dependencies.Now)), nil
}
