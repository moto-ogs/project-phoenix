package compose

import (
	"context"

	facilitiesModule "github.com/moto-ogs/project-phoenix/modules/facilities"
	facilitiesService "github.com/moto-ogs/project-phoenix/modules/facilities/internal/application/roomservice"
)

func NewRoomNameDirectory(rooms facilitiesService.RoomNameRecords) facilitiesModule.RoomNameDirectory {
	return facilitiesService.NewRoomNameDirectory(rooms)
}

func FindRoomNames(ctx context.Context, rows facilitiesModule.RoomRows, ids []int64) ([]*facilitiesModule.RoomName, error) {
	return facilitiesService.FindRoomNames(ctx, rows, ids)
}
