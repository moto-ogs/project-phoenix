package contracttest_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A guardian's edit of an open offering change carries the version of the
// request the guardian read (ADR 0311): an outdated or missing one is refused
// and writes nothing, the current one saves.
func TestOfferingChangeEditRequiresTheReadVersion(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	svc := newOfferingChangeServiceForTest(t, env)
	fx := setupOfferingChangeFixture(t, env, "EditVersion")
	ctx := offeringChangeAdminContext(t)
	input := careplan.CreateOfferingChangeInput{
		StudentID: fx.studentID, AccountID: env.creatorID, EffectiveFrom: fx.switchDate,
		Selections: []careplan.OfferingChangeSelection{{OfferingID: fx.newOffering.ID, SelectedDays: []string{"mon"}}},
	}
	request, err := testpkg.TenantQuery1(t, ctx, env.db, svc.SubmitOfferingChange, input)
	require.NoError(t, err)

	input.Note = "Bitte ab Montag"
	for _, expected := range []string{"stale", ""} {
		_, err := testpkg.TenantQuery3(t, ctx, env.db, svc.Edit, request.ID, input, expected)
		require.ErrorIs(t, err, readstate.ErrChanged, "version %q", expected)
	}
	stored, err := testpkg.TenantQuery2(t, ctx, env.db, env.repos.CarePlan().FindOfferingChange, request.ID, false)
	require.NoError(t, err)
	require.Nil(t, stored.ParentNote, "a refused edit writes nothing")

	edited, err := testpkg.TenantQuery3(t, ctx, env.db, svc.Edit, request.ID, input, testpkg.OfferingRequestVersion(t, request.ID))
	require.NoError(t, err)
	require.NotNil(t, edited.ParentNote)
	require.Equal(t, "Bitte ab Montag", *edited.ParentNote)
}
