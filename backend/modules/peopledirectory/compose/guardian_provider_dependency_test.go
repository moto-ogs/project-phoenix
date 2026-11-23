package compose

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type linkUpdateGuardians struct {
	peoplePorts.GuardianService
	primary *[]int64
}

func (s linkUpdateGuardians) UpdateStudentGuardianRelationship(_ context.Context, relationshipID int64, _ peoplePorts.StudentGuardianUpdateRequest) error {
	*s.primary = append(*s.primary, relationshipID)
	return nil
}

type directTenantTx struct{ runs *int }

func (r directTenantTx) InTenantTx(ctx context.Context, fn func(context.Context) error) error {
	*r.runs++
	return fn(ctx)
}

// The guardian provider passed in Dependencies serves the guardian calls from
// construction on, in its tenant transaction; an incomplete provider is a
// construction error.
func TestNew_TakesTheGuardianProvider(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	deps := Dependencies{StudentDirectory: testpkg.StudentDirectory{}, DB: db, Observe: func(Observation) {}}

	var primary []int64
	runs := 0
	deps.GuardianProvider = &GuardianDirectoryProvider{
		Guardians: linkUpdateGuardians{primary: &primary}, Runtime: directTenantTx{runs: &runs},
		PermissionGranted: func(any) bool { return true },
	}
	module, err := New(deps, nil)
	require.NoError(t, err)
	linkID := int64(len(t.Name()))
	require.NoError(t, module.UpdateGuardianLink(context.Background(), linkID, peopledirectory.GuardianLinkUpdate{}))
	require.Equal(t, []int64{linkID}, primary)
	require.Equal(t, 1, runs)

	deps.GuardianProvider = &GuardianDirectoryProvider{Guardians: linkUpdateGuardians{primary: &primary}, Runtime: directTenantTx{runs: &runs}}
	_, err = New(deps, nil)
	require.ErrorContains(t, err, "guardian provider needs")
}
