package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	portalCompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
	"github.com/stretchr/testify/require"
)

// TestParentChildReadsCheckElternAppOnARealDatabase: the Eltern-App check of
// the child reads (#4895) runs inside the portal's administrative unit. It
// has to answer there for every school of the account, also for one whose
// switch no earlier read of the request holds (#7967). One account, two
// schools, one of them without Eltern-App.
func TestParentChildReadsCheckElternAppOnARealDatabase(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	settings, err := owners.NewSettingsTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	rig := newChildReadRigOn(t, db, func(deps *portalCompose.Dependencies) {
		deps.ChildRepo, err = owners.ParentChildReadsForBookedSchools(deps.ChildRepo, settings.Settings)
		require.NoError(t, err)
	})
	ctx := context.Background()
	family := rig.family(t)
	var childB int64
	bookSchoolB := func(bool) {}
	t.Run("school B", func(t *testing.T) {
		schoolB := testpkg.OwnTenant(t)
		testpkg.EnsureTestTenant(t, rig.db, schoolB)
		student := testpkg.CreateTestStudent(t, rig.db, "Zweite", "SchuleB", "2b")
		profile := testpkg.CreateTestGuardianProfileForTenant(t, rig.db, schoolB, "Sabine", "SchuleB", "familie-b")
		_, err := rig.db.NewRaw(`UPDATE users.guardian_profiles SET account_id = ?, has_account = true WHERE id = ?`, family.AccountID, profile.ID).Exec(ctx)
		require.NoError(t, err)
		testpkg.CreateTestStudentGuardianLinkForTenant(t, rig.db, schoolB, student.ID, profile.ID, "primary_guardian")
		_, err = rig.db.NewRaw(`INSERT INTO auth.account_tenants (account_id, tenant_id, status, activated_at) VALUES (?, ?, 'active', now()) ON CONFLICT (account_id, tenant_id) DO UPDATE SET status = 'active'`, family.AccountID, schoolB).Exec(ctx)
		require.NoError(t, err)
		childB = student.ID
		schoolCtx := testpkg.Ctx(t)
		bookSchoolB = func(booked bool) {
			require.NoError(t, settings.Settings.SetValue(schoolCtx, "module.eltern_app", booked, nil, nil))
		}
	})
	masterData := func(studentID int64) string { return childReadRoutes(studentID, family.requestID)["master_data"] }
	listed := func(studentID int64) string { return fmt.Sprintf(`"student_id":"%d"`, studentID) }

	// Both schools book Eltern-App: the list and each child answer.
	list := rig.serve(t, "/parent/me/children", family.token)
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	require.Contains(t, list.Body.String(), listed(family.StudentID))
	require.Contains(t, list.Body.String(), listed(childB))
	for _, studentID := range []int64{family.StudentID, childB} {
		rec := rig.serve(t, masterData(studentID), family.token)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}

	// School B cancels Eltern-App: its child reads as not linked, the child
	// of school A stays.
	bookSchoolB(false)
	list = rig.serve(t, "/parent/me/children", family.token)
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	require.Contains(t, list.Body.String(), listed(family.StudentID))
	require.NotContains(t, list.Body.String(), listed(childB))
	rec := rig.serve(t, masterData(family.StudentID), family.token)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = rig.serve(t, masterData(childB), family.token)
	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	require.Equal(t, "care.child_not_linked", childReadCode(t, rec))

	// School B books it again: the child is back.
	bookSchoolB(true)
	list = rig.serve(t, "/parent/me/children", family.token)
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	require.Contains(t, list.Body.String(), listed(childB))
}
