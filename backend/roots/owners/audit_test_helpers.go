//go:build testhooks

package owners

import (
	"time"

	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// NewTestAuditPersistence composes the Audit persistence over the test
// database: reads and appends go through the Audit handoff on the context
// with the database as the fallback. A non-nil command routes every write
// through it, as the service graph routes its repositories.
func NewTestAuditPersistence(db transactionruntime.Database, command auditModels.Command) *auditCompose.Persistence {
	audits := auditCompose.MustNewPersistence(auditCompose.PersistenceDependencies{DB: db.Pool()})
	if command != nil {
		audits = audits.WithRoutedWrites(command)
	}
	return audits
}

// NewTestAuditStore composes the Audit append store over the test database
// for narrow test compositions, on the real clock.
func NewTestAuditStore(db transactionruntime.Database) auditModels.AppendStore {
	return NewTestAuditStoreAt(db, nil)
}

// NewTestAuditStoreAt composes the Audit append store on the Audit clock
// now, the clock of the command it serves (nil: the real one); it stamps
// the ledgers the database does not.
func NewTestAuditStoreAt(db transactionruntime.Database, now func() time.Time) auditModels.AppendStore {
	return auditCompose.MustNewPersistence(auditCompose.PersistenceDependencies{DB: db.Pool(), Now: now}).AppendStore
}

// NewEnrollmentFlowTestRepositories composes the enrollment flow suites'
// repositories with the audit repositories the flows read and write.
func NewEnrollmentFlowTestRepositories(db transactionruntime.Database) (*EnrollmentFlowTestRepositories, error) {
	return NewEnrollmentFlowTestRepositoriesWithMembers(db, MustNewMembershipTestRepositories(db))
}
