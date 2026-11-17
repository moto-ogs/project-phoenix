//go:build testhooks

package api

import (
	"context"
	"log/slog"
	"time"

	peopleCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/realtime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/moto-ogs/project-phoenix/workflows/staffoffboarding"
)

// NewSpringerExitsForTest builds the Worker's Springer exits (#7197) as
// PlannedStaffExitsJob does, without notices. The run takes the school's
// tenant transaction and answers the outcome of each exit in its order; a
// failed exit is an error. now is the Worker's clock.
func NewSpringerExitsForTest(db transactionruntime.Database, unit tenant.UnitOfWork, now func() time.Time) (func(context.Context) ([]string, error), error) {
	identity, err := lifecycleTestModule(db, unit, GuardianInvitationTestConfig{})
	if err != nil {
		return nil, err
	}
	offboarding, err := NewStaffOffboardingOwners(db, peopleCompose.MustNewReads(db.Pool(), owners.StudentDirectoryReader()),
		owners.MembershipStaffEmployment(MustNewStaffEmployment(db)), nil, now)
	if err != nil {
		return nil, err
	}
	workflow := newStaffOffboardingWorkflow(realtime.NewHub(slog.Default()), identity, offboarding, nil, StaffMembershipHooks{
		ResolveEditorStaffID:           func(context.Context) (int64, error) { return 0, staffoffboarding.ErrUnauthorized },
		QueueOffboardedDocumentCleanup: func(context.Context, int64) error { return nil },
	})
	due, err := staffoffboarding.NewDueExits(newStaffExitPlanner(workflow, offboarding), staffoffboarding.DueExitDependencies{
		Notify:         func(context.Context, staffoffboarding.ExitNotice) (bool, error) { return true, nil },
		Within:         PlannedExitTransaction,
		BoundLockWaits: BoundPlannedExitLockWaits(30 * time.Second),
		Isolate:        isolatePlannedExit,
		Now:            now,
	})
	if err != nil {
		return nil, err
	}
	springers := springerStaffExits(due, identity)
	return func(ctx context.Context) ([]string, error) {
		run, err := springers.RunDue(ctx)
		outcomes := make([]string, 0, len(run.Exits))
		for _, exit := range run.Exits {
			if exit.Outcome == staffoffboarding.ExitFailed {
				return nil, exit.Err
			}
			outcomes = append(outcomes, exit.Outcome)
		}
		return outcomes, err
	}, nil
}
