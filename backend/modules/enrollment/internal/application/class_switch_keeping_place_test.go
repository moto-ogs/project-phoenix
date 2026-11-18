package application

import (
	"context"
	"testing"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type recordingClassSwitchChildren struct {
	DecisionChildren
	planned []*enrollmentNative.ClassSwitch
}

func (r *recordingClassSwitchChildren) SetChildClassSwitch(_ context.Context, _ int64, change *enrollmentNative.ClassSwitch) error {
	r.planned = append(r.planned, change)
	return nil
}

// TestDeferredRenewalPlansTheFirstDayForAChildWithoutCarePlace keeps a plan
// that keeps the class for a child without an OGS place (#4803 review): its
// switch day is the day the deferred approval grants the place. Any other
// child keeps the old rule, no plan for an unchanged class.
func TestDeferredRenewalPlansTheFirstDayForAChildWithoutCarePlace(t *testing.T) {
	t.Parallel()
	children := &recordingClassSwitchChildren{}
	d := &Decisions{deps: DecisionDependencies{Children: children}}
	same := &enrollmentNative.ClassSwitch{RequestChildID: 7, From: "2a", To: "2a", On: "2030-08-01"}

	require.NoError(t, d.planClassSwitchKeepingPlace(context.Background(), 7, same, true))
	require.NoError(t, d.planClassSwitchKeepingPlace(context.Background(), 7, same, false))

	require.Len(t, children.planned, 2)
	assert.Equal(t, same, children.planned[0], "the child without a place keeps its first-day plan")
	assert.Nil(t, children.planned[1], "any other child plans nothing for an unchanged class")
}
