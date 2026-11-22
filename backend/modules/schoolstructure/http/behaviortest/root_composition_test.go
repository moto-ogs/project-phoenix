package schoolstructurehttp_test

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The typed root's test compositions these suites build: each opens the
// package's test database and composes the module through the root (#4005).

func setupGroupsModule(t *testing.T, publishers ...*testpkg.RecordingBroadcaster) (*bun.DB, api.GroupsTestModule, api.ActivePeople) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	var module api.GroupsTestModule
	var people api.ActivePeople
	var err error
	if len(publishers) > 0 && publishers[0] != nil {
		module, _, people, _, err = api.NewGroupsTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), publishers[0])
	} else {
		module, _, people, _, err = api.NewGroupsTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	}
	require.NoError(t, err)
	return db, module, people
}
