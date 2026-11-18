package compose

import (
	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/application"
)

// NewStudentDocumentFileSeal is the maintenance-only seal of the child health
// document files (#3840), never HTTP.
func NewStudentDocumentFileSeal() careplan.StudentDocumentFileSeal {
	return application.NewStudentDocumentFileSeal(postgres.NewStudentDocumentFileSealStore())
}
