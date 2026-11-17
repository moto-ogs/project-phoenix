//go:build testhooks

package owners

import (
	"context"
	"time"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	delivery "github.com/moto-ogs/project-phoenix/modules/delivery/runtime"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// NewEnrollmentFlowOutcomes reads what became of the mails of the fixtures.
func NewEnrollmentFlowOutcomes(db transactionruntime.Database) (delivery.EmailOutcomes, error) {
	runtime, err := deliveryCompose.NewModule(deliveryCompose.ModuleDependencies{
		DB: db.Pool(), People: EnrollmentFlowGuardianDirectory{},
		Observe: func(deliveryContract.Observation) {},
	})
	if err != nil {
		return nil, err
	}
	return runtime.EmailOutcomes, nil
}

// NewEnrollmentFlowDelivery composes the Delivery platform over the test
// database with a provider that accepts every send, on the first clock (the
// real one when none is given).
func NewEnrollmentFlowDelivery(db transactionruntime.Database, clocks ...func() time.Time) (delivery.Capability, error) {
	var now func() time.Time
	if len(clocks) > 0 {
		now = clocks[0]
	}
	runtime, err := deliveryCompose.NewModule(deliveryCompose.ModuleDependencies{
		DB: db.Pool(), People: EnrollmentFlowGuardianDirectory{}, Now: now,
		Observe: func(deliveryContract.Observation) {},
	})
	if err != nil {
		return nil, err
	}
	if _, err := deliveryCompose.NewWorker(runtime, enrollmentFlowDeliveryProvider{}); err != nil {
		return nil, err
	}
	return runtime.Module, nil
}

type enrollmentFlowDeliveryProvider struct{}

func (enrollmentFlowDeliveryProvider) SendEmail(context.Context, deliveryContract.ClaimedIntent) (deliveryContract.ProviderResult, error) {
	return deliveryContract.ProviderResult{}, nil
}

func (enrollmentFlowDeliveryProvider) SendPush(context.Context, deliveryContract.ClaimedIntent) (deliveryContract.ProviderResult, error) {
	return deliveryContract.ProviderResult{}, nil
}

type EnrollmentFlowGuardianDirectory struct{}

func (EnrollmentFlowGuardianDirectory) ResolveGuardianDisplays(context.Context, []int64) ([]deliveryContract.GuardianDisplay, error) {
	return nil, nil
}
