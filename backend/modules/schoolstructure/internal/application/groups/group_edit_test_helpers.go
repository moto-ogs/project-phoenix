//go:build testhooks

package groups

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure/contract"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure/internal/domain"
)

// EditAsStored writes the row's name and room as an edit of the group as it
// is stored now: the version comes from the detail reads just before (ADR
// 0311). The retained group tests write through it.
func EditAsStored(ctx context.Context, management schoolstructure.GroupManagement, row *domain.Group) error {
	if row == nil {
		return management.UpdateGroup(ctx, schoolstructure.GroupEdit{})
	}
	group, err := management.FindGroupWithRoom(ctx, row.ID.Int64())
	if err != nil {
		return err
	}
	teachers, err := management.GetGroupTeachers(ctx, row.ID.Int64())
	if err != nil {
		return err
	}
	ids := make([]int64, 0, len(teachers))
	for _, teacher := range teachers {
		ids = append(ids, teacher.ID)
	}
	return management.UpdateGroup(ctx, schoolstructure.GroupEdit{
		ID: row.ID.Int64(), Name: row.Name, SetRoom: true, RoomID: (*int64)(row.RoomID),
		ExpectedVersion: contract.GroupVersion(group, ids),
	})
}
