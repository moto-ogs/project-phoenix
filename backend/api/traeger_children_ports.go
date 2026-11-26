package api

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	peopleDirectoryCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	schoolMembershipCompose "github.com/moto-ogs/project-phoenix/modules/schoolmembership/compose"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// traegerChildrenPorts binds the owners' reads behind the children of the
// Träger by name (#8137, ADR 0327): the names of the counted children at
// People Directory and their school class and OGS group at School
// Membership. The roster and the group names are the ports of the school
// view and of the occupancy.
func traegerChildrenPorts() traegerview.ChildrenPorts {
	return traegerview.ChildrenPorts{
		Names:      traegerStudentNames{names: peopleDirectoryCompose.NewSchoolStudentNames()},
		Placements: schoolMembershipCompose.NewSchoolRosters(),
	}
}

type traegerStudentNames struct {
	names peopledirectory.SchoolStudentNames
}

func (n traegerStudentNames) StudentNamesByTenant(ctx context.Context, schools []int64, query traegerview.StudentNameQuery) ([]traegerview.StudentName, int, error) {
	names, matched, err := n.names.StudentNamesByTenant(ctx, schools, peopledirectory.SchoolStudentNameQuery{
		StudentProfileIDs: query.Students, Search: query.Search, Limit: query.Limit, Offset: query.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	result := make([]traegerview.StudentName, 0, len(names))
	for _, name := range names {
		result = append(result, traegerview.StudentName(name))
	}
	return result, matched, nil
}
