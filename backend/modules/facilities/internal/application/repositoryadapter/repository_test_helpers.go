//go:build testhooks

package repositoryadapter

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
)

type roomCommand = facilities.Command

// Repository adds room writes for fixtures that still arrange retained rows.
type Repository struct {
	*Records
	roomCommand
}

func New(rooms facilities.Capability) *Repository {
	if rooms == nil {
		panic("room repository adapter: Facilities capability is required")
	}
	return &Repository{Records: NewRecords(rooms), roomCommand: rooms}
}

func (r *Repository) Create(ctx context.Context, room *facilities.Room) error {
	if room == nil {
		return errors.New("room cannot be nil")
	}
	created, err := r.CreateRoom(ctx, facilities.CreateRoom{
		Name: room.Name, Building: room.Building, Floor: room.Floor, Capacity: room.Capacity,
		Category: room.Category, Color: room.Color, IsSystem: room.IsSystem,
		IsOpenRoom: room.IsOpenRoom,
	})
	if err == nil {
		*room = created
	}
	return err
}

func (r *Repository) Update(ctx context.Context, room *facilities.Room) error {
	if room == nil {
		return errors.New("room cannot be nil")
	}
	updated, err := r.UpdateRoom(ctx, facilities.UpdateRoom{
		ID: room.ID, Name: room.Name, Building: room.Building, Floor: room.Floor,
		Capacity: room.Capacity, Category: room.Category, Color: room.Color,
		// Legacy callers read-modify-write a whole room, so the loaded
		// release value is passed back explicitly. Sending nil here would
		// make every legacy save silently skip the column instead of
		// preserving what the caller actually holds.
		IsOpenRoom: &room.IsOpenRoom,
		// The legacy row is the state its caller read: it carries that
		// version (ADR 0311).
		ExpectedVersion: facilities.RoomVersion(*room),
	})
	if err == nil {
		*room = updated
	}
	return err
}

func (r *Repository) Delete(ctx context.Context, rawID any) error {
	id, err := roomID(rawID)
	if err != nil {
		return err
	}
	// A fixture removes the room as its preview says.
	impact, err := r.RoomRemovalImpact(ctx, id)
	if err != nil {
		return err
	}
	_, err = r.DeleteRoom(ctx, id, impact.Fingerprint())
	return err
}
