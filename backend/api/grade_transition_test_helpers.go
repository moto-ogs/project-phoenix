//go:build testhooks

package api

import (
	"context"
	"log/slog"
	"time"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	"github.com/go-chi/chi/v5"
	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	parentStore "github.com/moto-ogs/project-phoenix/modules/communication/parentstore"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/workflows/gradetransition"
	gradetransitioncompose "github.com/moto-ogs/project-phoenix/workflows/gradetransition/compose"
	gradetransitionhttp "github.com/moto-ogs/project-phoenix/workflows/gradetransition/http"
)

// GradeTransitionTestModule composes the grade transition workflow (#2711)
// the way the production root does, over the real People Directory, School
// Membership, School Structure, Student Presence and the Timetable roster
// reconciliation.
type GradeTransitionTestModule struct {
	GradeTransition *gradetransition.Workflow
}

// OfferingResync is the offering-roster resync the workflow runs after the
// class rewrite. A nil resync is a no-op: the HTTP tests exercise the
// transition contract, and the resync has its own hermetic coverage with the
// real enrollment decision service.
type OfferingResync func(ctx context.Context, effectiveFrom timezone.Date) error

func NewGradeTransitionTestModule(db transactionruntime.Database, resync OfferingResync, clocks ...func() time.Time) (GradeTransitionTestModule, error) {
	command, err := auditCompose.NewCommand(owners.NewTestAuditStore(db), func(auditCompose.AppendObservation) {}, time.Now)
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	tt, err := NewTimetableTestRepositories(db, clocks...)
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	people, err := owners.NewPeopleDirectory(db)
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	membership, err := owners.NewSchoolMembership(db)
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	if resync == nil {
		resync = func(context.Context, timezone.Date) error { return nil }
	}
	clock := OptionalClock(clocks)
	cohorts, err := owners.NewTimetableCohortRosters(tt.Repositories, people, nil, slog.Default())
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	recurrenceLock, err := owners.NewTimetableTestRecurrenceLock(db)
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	structure, presence, err := NewGradeTransitionOwners(db, clock)
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	workflow, err := owners.NewGradeTransition(gradetransitioncompose.Dependencies{
		Structure: structure, Presence: presence, Directory: people, Membership: membership,
		Rosters:               tt.RosterMaintenance(slog.Default(), clock),
		ParentTargets:         NewGradeTransitionParentTargets(db),
		LockRecurrenceWrites:  recurrenceLock.LockRecurrenceWrites,
		ResyncOfferingRosters: resync,
		FollowClassChanges:    gradeTransitionClassChanges(cohorts),
		Audit:                 command, ClassListEntryRecord: GradeTransitionClassListRecord, Clock: clock,
	})
	if err != nil {
		return GradeTransitionTestModule{}, err
	}
	return GradeTransitionTestModule{GradeTransition: workflow}, nil
}

// NewGradeTransitionParentTargets binds the workflow's parent-channel port to
// Communication's class transitions, as the production root does (#8214).
func NewGradeTransitionParentTargets(db transactionruntime.Database) gradetransition.ParentClassTargets {
	return owners.GradeTransitionParentTargets(parentStore.NewParentClassTransitions(db.Pool()))
}

// Router mounts the grade transition routes over the composed workflow.
func (m GradeTransitionTestModule) Router() chi.Router {
	return gradetransitionhttp.NewGradeTransitionResource(m.GradeTransition).Router(ProtectedTenantRoutes)
}
