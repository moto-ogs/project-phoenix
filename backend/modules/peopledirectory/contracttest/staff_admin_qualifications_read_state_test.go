package contracttest_test

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ADR 0311: the qualification list saved over a read a colleague changed
// since is refused with nothing written; the current version saves.
func TestStaffQualificationsRefuseAStaleRead(t *testing.T) {
	t.Parallel()

	s := newStammdatenScenario(t)
	staff := testpkg.CreateTestStaff(t, s.db, "Stamm", "Lesestand")
	actor := testpkg.CreateTestStaff(t, s.db, "Stamm", "Kollegin")
	read, err := testpkg.TenantQuery1(t, s.ctx, s.db, s.svc.StaffStammdaten, staff.ID)
	require.NoError(t, err)

	// A colleague records a proof after the read.
	err = testpkg.TenantCommand5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
		[]workforce.StammdatenQualificationInput{{Name: "Erste Hilfe"}}, (*string)(nil), actor.ID, "Kollegin")
	require.NoError(t, err)
	for _, stale := range []string{read.Versions.Qualifikationen, ""} {
		err = testpkg.TenantCommand5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
			[]workforce.StammdatenQualificationInput{{Name: "Schwimmschein"}}, &stale, actor.ID, "Ich")
		require.ErrorIs(t, err, readstate.ErrChanged, "token %q", stale)
	}
	current, err := testpkg.TenantQuery1(t, s.ctx, s.db, s.svc.StaffStammdaten, staff.ID)
	require.NoError(t, err)
	require.Len(t, current.Qualifications, 1)
	assert.Equal(t, "Erste Hilfe", current.Qualifications[0].Name, "nothing is written")
	require.Len(t, s.auditRows(t, staff.ID), 1)

	err = testpkg.TenantCommand5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
		[]workforce.StammdatenQualificationInput{{Name: "Schwimmschein"}}, &current.Versions.Qualifikationen, actor.ID, "Ich")
	require.NoError(t, err)
}
