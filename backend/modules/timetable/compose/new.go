// Package compose wires the Timetable & Activities module over the tenant runtime and Bun.
package compose

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/ports"
	nativeports "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

type Observation = ports.Observation

type Dependencies struct {
	DB       *bun.DB
	Students nativeports.StudentDirectory
	Rooms    timetable.RoomDirectory
	// Sessions: which planned rows Student Presence executed or observed (#2762).
	Sessions timetable.SessionFacts
	// LockStaffAssignments locks live Membership staff before linking them.
	LockStaffAssignments func(context.Context, []int64) error
	Observe              func(Observation)
	Provenance           postgres.EnrollmentProvenance
	Now                  func() time.Time // the owner's clock, its school day the Berlin day; nil is the real clock
}

func New(dependencies Dependencies) (timetable.Owner, error) {
	if dependencies.DB == nil || dependencies.Students == nil || dependencies.Rooms == nil || dependencies.Sessions == nil || dependencies.LockStaffAssignments == nil || dependencies.Observe == nil || dependencies.Provenance == nil {
		return nil, errors.New("timetable compose: all dependencies are required")
	}
	store := postgres.New(postgres.DatabaseRuntime(dependencies.DB)).WithClock(dependencies.Now)
	return application.New(store, transaction{}, application.NewStudentDirectory(dependencies.Students), application.NewRoomDirectory(dependencies.Rooms), dependencies.Sessions,
		dependencies.LockStaffAssignments, application.NewClock(dependencies.Now), dependencies.Observe, postgres.NewProvenanceStore(store, dependencies.Provenance)), nil
}

type transaction struct{}

func (transaction) RunWrite(ctx context.Context, retry bool, callback func(context.Context) error) error {
	return postgres.TransactionRunWriteBinding(ctx, retry, callback, tenant.WithinCurrentTenant, tenant.WithinTenantRetry)
}
