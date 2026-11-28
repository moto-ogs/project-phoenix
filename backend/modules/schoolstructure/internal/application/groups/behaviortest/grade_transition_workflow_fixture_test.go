package groups_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"
	rootowners "github.com/moto-ogs/project-phoenix/roots/owners"

	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/moto-ogs/project-phoenix/workflows/gradetransition"
	gradetransitioncompose "github.com/moto-ogs/project-phoenix/workflows/gradetransition/compose"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// transitionFixture assembles the grade transition workflow (#2711) over the
// real owner compositions the production root uses: People Directory,
// School Membership, School Structure, Student Presence, the Timetable
// roster reconciliation and the ambient-transaction audit command. Only the
// HTTP principal is replaced by a fixed actor of the test's tenant; every
// port stays swappable through deps so a test can wrap one owner command or
// record the resync.
type transitionFixture struct {
	db         *bun.DB
	tenantID   int64
	people     gradetransition.Directory
	membership gradetransition.Membership
	deps       gradetransition.Dependencies
	actorID    int64
	now        time.Time
	// resyncCalls records every offering-roster resync the workflow triggers.
	resyncCalls []calendar.Date
	// classChangeCalls records every class follow-up on targeted
	// Regeltermine (#6841).
	classChangeCalls [][]gradetransition.ClassChange
}

// newTransitionFixture composes the workflow with the clock pinned to a fixed
// Berlin instant.
func newTransitionFixture(t *testing.T, db *bun.DB) *transitionFixture {
	t.Helper()
	f := &transitionFixture{db: db, tenantID: testpkg.Tenant(t), now: time.Date(2026, 8, 24, 12, 0, 0, 0, calendar.Berlin)}
	clock := func() time.Time { return f.now }
	owners, people, membership, err := api.NewGradeTransitionSuiteOwners(testpkg.NewDatabase(t, db), clock)
	require.NoError(t, err)
	f.people = people
	f.membership = membership
	actor := testpkg.CreateTestAccount(t, db, fmt.Sprintf("grade-transition-actor-%d", f.tenantID))
	f.actorID = actor.ID
	structure, presence, err := api.NewGradeTransitionOwners(testpkg.NewDatabase(t, db), clock)
	require.NoError(t, err)
	deps, err := rootowners.AssembleGradeTransition(gradetransitioncompose.Dependencies{
		DB: db, Structure: structure, Presence: presence, Directory: f.people, Membership: f.membership,
		Rosters:              owners.Rosters,
		ParentTargets:        api.NewGradeTransitionParentTargets(testpkg.NewDatabase(t, db)),
		LockRecurrenceWrites: owners.LockRecurrenceWrites,
		ResyncOfferingRosters: func(_ context.Context, effectiveFrom calendar.Date) error {
			f.resyncCalls = append(f.resyncCalls, effectiveFrom)
			return nil
		},
		FollowClassChanges: func(_ context.Context, changes []gradetransition.ClassChange, _ calendar.Date) error {
			f.classChangeCalls = append(f.classChangeCalls, changes)
			return nil
		},
		Audit:                api.MustNewWorkflowAuditCommand(testpkg.NewDatabase(t, db), "grade transition audit append failed"),
		ClassListEntryRecord: api.GradeTransitionClassListRecord,
		Clock:                clock,
	})
	require.NoError(t, err)
	deps.Authorize = func(context.Context, string) (gradetransition.Actor, error) {
		return gradetransition.Actor{TenantID: f.tenantID, AccountID: f.actorID}, nil
	}
	f.deps = deps
	return f
}

// today is the calendar day the workflow sees.
func (f *transitionFixture) today() calendar.Date { return calendar.DateFromTime(f.now) }

// workflow constructs the workflow over the current deps.
func (f *transitionFixture) workflow(t *testing.T) *gradetransition.Workflow {
	t.Helper()
	workflow, err := gradetransition.New(f.deps)
	require.NoError(t, err)
	return workflow
}

// findTransition reads one transition as the list answers it: the keyset
// window behind the id before it starts with that transition.
func findTransition(ctx context.Context, workflow *gradetransition.Workflow, id int64) (schoolstructure.Transition, error) {
	after := id - 1
	rows, _, err := workflow.ListTransitions(ctx, gradetransition.ListFilter{AfterID: &after, PageSize: 1})
	if err != nil {
		return schoolstructure.Transition{}, err
	}
	if len(rows) == 0 || rows[0].ID != id {
		return schoolstructure.Transition{}, gradetransition.ErrTransitionNotFound
	}
	return rows[0], nil
}

// previewed is the fingerprint an admin confirms before an apply: the one the
// preview answers (ADR 0311), or none where there is no preview to show.
func previewed(ctx context.Context, workflow *gradetransition.Workflow, transitionID int64) string {
	preview, err := workflow.Preview(ctx, transitionID)
	if err != nil {
		return ""
	}
	return preview.Fingerprint
}

// createDraft stores a draft with the given mappings through the workflow.
func (f *transitionFixture) createDraft(t *testing.T, ctx context.Context, academicYear string, mappings ...gradetransition.Mapping) int64 {
	t.Helper()
	transition, err := f.workflow(t).CreateDraft(ctx, gradetransition.Draft{AcademicYear: academicYear, Mappings: mappings})
	require.NoError(t, err)
	return transition.ID
}

// promote and graduate build mapping inputs.
func promote(from, to string) gradetransition.Mapping {
	return gradetransition.Mapping{FromClass: from, ToClass: &to}
}

func graduate(from string) gradetransition.Mapping {
	return gradetransition.Mapping{FromClass: from}
}
