package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

var _ peopledirectory.StudentRecordEdits = (*Service)(nil)

// LockStudentRecordForEdit locks the child's row and then its person and
// checks the edit form's version against that locked state (ADR 0311).
func (s *Service) LockStudentRecordForEdit(ctx context.Context, studentID int64, expectedVersion string) (peopledirectory.StudentRecord, peopledirectory.Person, error) {
	record, err := s.FindStudentRecordForMutation(ctx, studentID)
	if err != nil {
		return peopledirectory.StudentRecord{}, peopledirectory.Person{}, err
	}
	person, err := s.FindPersonForMutation(ctx, record.PersonID)
	if err != nil {
		return peopledirectory.StudentRecord{}, peopledirectory.Person{}, err
	}
	version := peopledirectory.StudentRecordVersion(*peopledirectory.StudentStateFromRecord(record), person)
	if err := readstate.Check(expectedVersion, version); err != nil {
		return peopledirectory.StudentRecord{}, peopledirectory.Person{}, err
	}
	return record, person, nil
}
