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
	_, err = testpkg.TenantQuery5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
		[]workforce.StammdatenQualificationInput{{Name: "Erste Hilfe"}}, (*string)(nil), actor.ID, "Kollegin")
	require.NoError(t, err)
	for _, stale := range []string{read.Versions.Qualifikationen, ""} {
		_, err = testpkg.TenantQuery5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
			[]workforce.StammdatenQualificationInput{{Name: "Schwimmschein"}}, &stale, actor.ID, "Ich")
		require.ErrorIs(t, err, readstate.ErrChanged, "token %q", stale)
	}
	current, err := testpkg.TenantQuery1(t, s.ctx, s.db, s.svc.StaffStammdaten, staff.ID)
	require.NoError(t, err)
	require.Len(t, current.Qualifications, 1)
	assert.Equal(t, "Erste Hilfe", current.Qualifications[0].Name, "nothing is written")
	require.Len(t, s.auditRows(t, staff.ID), 1)

	_, err = testpkg.TenantQuery5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
		[]workforce.StammdatenQualificationInput{{Name: "Schwimmschein"}}, &current.Versions.Qualifikationen, actor.ID, "Ich")
	require.NoError(t, err)
}

// A saved list answers the token of the rows as stored, with the ids the new
// rows got (ADR 0311, rule 5): the next save of the same editing sends it and
// is not refused.
func TestStaffQualificationsAnswerTheStoredToken(t *testing.T) {
	t.Parallel()

	s := newStammdatenScenario(t)
	staff := testpkg.CreateTestStaff(t, s.db, "Stamm", "Antwort")
	actor := testpkg.CreateTestStaff(t, s.db, "Stamm", "Leitung")
	read, err := testpkg.TenantQuery1(t, s.ctx, s.db, s.svc.StaffStammdaten, staff.ID)
	require.NoError(t, err)

	answered, err := testpkg.TenantQuery5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
		[]workforce.StammdatenQualificationInput{{Name: " Erste Hilfe "}}, &read.Versions.Qualifikationen, actor.ID, "Neu")
	require.NoError(t, err)
	stored, err := testpkg.TenantQuery1(t, s.ctx, s.db, s.svc.StaffStammdaten, staff.ID)
	require.NoError(t, err)
	assert.Equal(t, stored.Versions.Qualifikationen, answered, "the answer covers the stored row with its new id")

	_, err = testpkg.TenantQuery5(t, s.ctx, s.db, s.svc.ReplaceStaffQualificationList, staff.ID,
		[]workforce.StammdatenQualificationInput{{Name: "Erste Hilfe"}, {Name: "Schwimmschein"}}, &answered, actor.ID, "Dazu")
	require.NoError(t, err, "the second save rests on the answer")
}
