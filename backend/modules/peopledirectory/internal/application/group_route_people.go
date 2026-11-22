package application

import (
	"context"

	peopleModule "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
)

// GroupRoutePeople binds the People Directory port of the group routes
// (modules/schoolstructure/http, #2742) to the retained person directory. It
// only translates the retained rows into the owner's public types and changes
// nothing about which reads run.
type GroupRoutePeople struct {
	groupStudentCounts
	persons peoplePorts.PersonDirectory
}

// groupStudentCounts is the student row count the group routes take as it is.
type groupStudentCounts interface {
	CountByGroupIDs(ctx context.Context, groupIDs []int64) (map[int64]int, error)
}

// NewGroupRoutePeople binds the retained person directory.
func NewGroupRoutePeople(persons peoplePorts.PersonDirectory) GroupRoutePeople {
	return GroupRoutePeople{groupStudentCounts: persons.StudentRows(), persons: persons}
}

// GroupStudents returns the children of a group.
func (p GroupRoutePeople) GroupStudents(ctx context.Context, groupID int64) ([]peopleModule.StudentRecord, error) {
	students, err := p.persons.StudentRows().FindByGroupID(ctx, groupID)
	if err != nil {
		return nil, err
	}
	result := make([]peopleModule.StudentRecord, 0, len(students))
	for _, student := range students {
		if student != nil {
			result = append(result, studentRouteRecord(student))
		}
	}
	return result, nil
}
