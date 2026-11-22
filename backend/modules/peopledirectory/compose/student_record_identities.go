package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/adapters/postgres"
)

// NewStudentRecordIdentities composes the read of child records by their
// identifiers (#7760) on the caller's school tenant transaction, over the
// student directory projection the root binds.
func NewStudentRecordIdentities(students StudentDirectoryRows) peopledirectory.StudentRecordIdentities {
	return postgres.NewStudentRecordIdentities(postgres.NewDatabase(), students)
}
