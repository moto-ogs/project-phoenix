package owners

import (
	"context"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// enrollmentContractPeople are the People Directory reads by id set the
// enrollment of the children of imported contracts uses (ADR 0309).
type enrollmentContractPeople interface {
	ListStudentsByID(context.Context, []int64) ([]peopledirectory.Student, error)
	ListPersonsByID(context.Context, []int64) ([]peopledirectory.Person, error)
}

// EnrollmentContractStudents reads the child records of a contract
// enrollment run with their persons from People Directory: one read of the
// child records and one of their persons, however many children.
type EnrollmentContractStudents struct {
	People enrollmentContractPeople
}

func (s EnrollmentContractStudents) ContractEnrollmentStudents(ctx context.Context, studentIDs []int64) (map[int64]enrollmentOwner.ContractStudent, error) {
	result := make(map[int64]enrollmentOwner.ContractStudent, len(studentIDs))
	if len(studentIDs) == 0 {
		return result, nil
	}
	students, err := s.People.ListStudentsByID(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	personIDs := make([]int64, 0, len(students))
	for _, student := range students {
		personIDs = append(personIDs, student.PersonID)
	}
	persons := map[int64]peopledirectory.Person{}
	if len(personIDs) > 0 {
		found, err := s.People.ListPersonsByID(ctx, personIDs)
		if err != nil {
			return nil, err
		}
		for _, person := range found {
			persons[person.ID] = person
		}
	}
	for _, student := range students {
		record := enrollmentOwner.ContractStudent{ID: student.ID, Status: student.Status, WithoutCarePlace: student.WithoutCarePlace}
		if person, known := persons[student.PersonID]; known {
			record.FirstName, record.LastName = person.FirstName, person.LastName
			if birthday, err := calendar.ParseDate(person.Birthday); err == nil && !birthday.IsZero() {
				record.Birthday = &birthday
			}
		}
		result[student.ID] = record
	}
	return result, nil
}
