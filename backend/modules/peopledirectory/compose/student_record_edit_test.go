package compose

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestLockStudentRecordForEditChecksTheFormsVersion: the owner checks the
// edit form's version under the locks of the child and its person (ADR
// 0311). The version the child read answers is the one it accepts; a form
// read before a colleague's change, or without a read, is refused, and the
// refusal leaves the stored child as it was.
func TestLockStudentRecordForEditChecksTheFormsVersion(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := New(Dependencies{DB: db, StudentDirectory: testpkg.StudentDirectory{}, StudentOwners: lockTestOwners{}, Observe: func(Observation) {}}, nil)
	require.NoError(t, err)
	edits := module.StudentRecordEdits
	require.NotNil(t, edits)
	student := testpkg.CreateTestStudent(t, db, "Edit", "Lock", "2b")

	readVersion := func() string {
		record, err := module.FindStudentRecord(ctx, student.ID)
		require.NoError(t, err)
		person, err := module.FindPerson(ctx, record.PersonID)
		require.NoError(t, err)
		return peopledirectory.StudentRecordVersion(*peopledirectory.StudentStateFromRecord(record), person)
	}
	lock := func(version string) (peopledirectory.StudentRecord, peopledirectory.Person, error) {
		var (
			record peopledirectory.StudentRecord
			person peopledirectory.Person
		)
		err := testpkg.WithTenantTx(t, ctx, db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
			var lockErr error
			record, person, lockErr = edits.LockStudentRecordForEdit(txCtx, student.ID, version)
			return lockErr
		})
		return record, person, err
	}

	opened := readVersion()
	record, person, err := lock(opened)
	require.NoError(t, err, "the version of the child read is accepted")
	require.Equal(t, student.ID, record.ID)
	require.Equal(t, "Lock", person.LastName)

	// A colleague renames the child after the form opened.
	require.NoError(t, testpkg.WithTenantTx(t, ctx, db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		_, updateErr := module.UpdatePerson(txCtx, peopledirectory.UpdatePerson{ID: person.ID, FirstName: person.FirstName, LastName: "Kollegin"})
		return updateErr
	}))
	for name, version := range map[string]string{"older read": opened, "no read": ""} {
		_, _, err := lock(version)
		require.ErrorIs(t, err, readstate.ErrChanged, name)
	}
	stored, err := module.FindPerson(ctx, person.ID)
	require.NoError(t, err)
	require.Equal(t, "Kollegin", stored.LastName, "a refused edit changes nothing")

	_, _, err = lock(readVersion())
	require.NoError(t, err, "a fresh read is accepted again")
}
