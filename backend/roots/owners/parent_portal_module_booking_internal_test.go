package owners

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// elternAppSwitches answers the batch read of the module switch: every asked
// school books Eltern-App except the cancelled ones, and a silent school gets
// no answer at all. It counts its reads.
type elternAppSwitches struct {
	cancelled, silent map[int64]bool
	err               error
	reads             *int
}

func (s elternAppSwitches) ResolveManyForTenants(_ context.Context, tenantIDs []int64, keys []string) (map[int64]*configModel.SettingsSnapshot, error) {
	if s.reads != nil {
		*s.reads++
	}
	if s.err != nil {
		return nil, s.err
	}
	result := map[int64]*configModel.SettingsSnapshot{}
	for _, id := range tenantIDs {
		if s.silent[id] {
			continue
		}
		var stored []*configModel.SettingValue
		if s.cancelled[id] {
			stored = []*configModel.SettingValue{{TenantID: id, SettingKey: keys[0], Value: json.RawMessage("false")}}
		}
		snapshot, err := configModel.NewSettingsSnapshot(configModel.DefaultRegistry(), id, keys, stored)
		if err != nil {
			return nil, err
		}
		result[id] = snapshot
	}
	return result, nil
}

type childQueriesStub struct {
	children []*careplan.ParentPortalChild
}

func (s childQueriesStub) FindForAccount(_ context.Context, _, studentID int64) (*careplan.ParentPortalChild, error) {
	for _, child := range s.children {
		if child.StudentID == studentID {
			return child, nil
		}
	}
	return nil, nil
}

func (s childQueriesStub) ListByAccount(context.Context, int64) ([]*careplan.ParentPortalChild, error) {
	return s.children, nil
}

func twoSchoolChildren() childQueriesStub {
	return childQueriesStub{children: []*careplan.ParentPortalChild{
		{StudentID: 1, TenantID: 41},
		{StudentID: 2, TenantID: 42},
	}}
}

// A guardian with children at two schools sees only the children of the
// school that booked Eltern-App (#4895).
func TestParentChildrenOfASchoolWithoutElternAppAreHidden(t *testing.T) {
	t.Parallel()
	reads, err := ParentChildReadsForBookedSchools(NewParentChildReads(twoSchoolChildren()), elternAppSwitches{cancelled: map[int64]bool{42: true}})
	require.NoError(t, err)

	children, err := reads.ListByAccount(context.Background(), 7)
	require.NoError(t, err)
	require.Len(t, children, 1)
	assert.Equal(t, int64(41), children[0].TenantID)

	child, err := reads.FindForAccount(context.Background(), 7, 2)
	require.NoError(t, err)
	assert.Nil(t, child, "a per-child flow treats the child as not linked")

	child, err = reads.FindForAccount(context.Background(), 7, 1)
	require.NoError(t, err)
	assert.NotNil(t, child)
}

func TestParentChildrenFailClosedOnReadErrors(t *testing.T) {
	t.Parallel()
	readErr := errors.New("settings unavailable")
	reads, err := ParentChildReadsForBookedSchools(NewParentChildReads(twoSchoolChildren()), elternAppSwitches{err: readErr})
	require.NoError(t, err)

	_, err = reads.ListByAccount(context.Background(), 7)
	require.ErrorIs(t, err, readErr)
	_, err = reads.FindForAccount(context.Background(), 7, 1)
	require.ErrorIs(t, err, readErr)
}

// The list asks for the switches of all schools in one read, and a school
// without an answer stays hidden (#7967).
func TestParentChildrenReadTheSwitchesOfAllSchoolsAtOnce(t *testing.T) {
	t.Parallel()
	reads := 0
	filtered, err := ParentChildReadsForBookedSchools(NewParentChildReads(twoSchoolChildren()), elternAppSwitches{silent: map[int64]bool{42: true}, reads: &reads})
	require.NoError(t, err)

	children, err := filtered.ListByAccount(context.Background(), 7)
	require.NoError(t, err)
	require.Len(t, children, 1)
	assert.Equal(t, int64(41), children[0].TenantID)
	assert.Equal(t, 1, reads)
}
