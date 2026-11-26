package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/adapters/postgres"
)

// NewSchoolStudentNames composes the names behind the Träger-Büro's list of the
// children of its schools (#8137, ADR 0327) on the caller's administrative
// transaction.
func NewSchoolStudentNames() peopledirectory.SchoolStudentNames {
	return postgres.NewSchoolStudentNames(postgres.NewDatabase())
}
