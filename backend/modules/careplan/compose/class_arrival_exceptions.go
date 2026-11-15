package compose

import (
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type ClassArrivalExceptionStore = ports.ClassArrivalExceptionStore
type ClassArrivalStudents = ports.ClassArrivalStudents

// NewClassArrivalExceptions builds the class arrival exceptions; today bounds
// the editable days and is the Berlin calendar day when nil.
func NewClassArrivalExceptions(store ClassArrivalExceptionStore, students ClassArrivalStudents, today func() calendar.Date) (careplan.ClassArrivalExceptions, error) {
	if store != nil && students == nil {
		return nil, errors.New("class arrival exceptions: student directory is required")
	}
	return application.NewClassArrivalExceptions(store, students, today), nil
}
