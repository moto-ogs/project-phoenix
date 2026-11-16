package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/enrollment/internal/adapters/postgres"
	applicationNative "github.com/moto-ogs/project-phoenix/modules/enrollment/internal/application"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewClocked binds Enrollment to the ambient transaction (never an unscoped pool) and stamps its writes with the required now (ADR 0239).
func NewClocked(now func() time.Time) enrollment.Owner {
	return NewWithStore(newStore().WithClock(now), applicationNative.ObserveOfferingStorage())
}

// NewWithStore binds owner commands to a supplied store and the tenant runtime.
func NewWithStore(store applicationNative.Store, observe func(enrollment.OfferingStorageObservation)) enrollment.Owner {
	return applicationNative.NewService(store, tenant.NewTransactionRunner(), observe)
}

func newStore() *postgres.Store {
	return postgres.NewStore(postgres.NewDatabase(), applicationNative.NewTenantID())
}

// NewOfferingSelectionReferences binds the catalog's deletion guard to the
// caller's school transaction and Enrollment's own selection table.
func NewOfferingSelectionReferences() enrollment.OfferingSelectionReferences { return newStore() }

// NewStudentAnswers reads the school's registration answers in the caller's tenant transaction (ADR 0231).
func NewStudentAnswers() enrollment.StudentAnswers {
	return applicationNative.NewStudentAnswers(newStore())
}
