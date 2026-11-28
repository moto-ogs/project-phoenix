//go:build testhooks

package owners

import (
	"github.com/moto-ogs/project-phoenix/modules/communication"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// NewParentGroupTargetNamesForTests binds the read-time names of the group
// threads (#8207) over the test database, as the root binds them.
func NewParentGroupTargetNamesForTests(tb TestTimetableTB, db transactionruntime.Database) communication.ParentGroupTargetNames {
	tb.Helper()
	return NewParentGroupTargetNames(NewSchoolStructureSuiteRepositories(db).Group, NewTestTimetable(tb, db))
}
