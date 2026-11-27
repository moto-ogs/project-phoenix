package facilities

import (
	"context"
	"errors"
	"fmt"
	"time"

	facilitiesModule "github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type OccupancyProjection func(context.Context, []facilitiesModule.Room) ([]RoomWithOccupancy, error)
type RoomHistoryProjection func(context.Context, int64, time.Time, time.Time, *int64) ([]facilitiesModule.RoomSessionEntry, error)

type ServiceConfig struct {
	// Rooms is the Facilities Catalog; the service deletes no room, so the
	// Rooms a root builds before the deletion guard serve it (#4080).
	Rooms     facilitiesModule.Catalog
	Occupancy OccupancyProjection
	History   RoomHistoryProjection
	// Today is the school day of the root's clock: the kiosk offers no room
	// closed on it (#7653).
	Today func() calendar.Date
}

type service struct {
	OccupancyProjection
	config ServiceConfig
}

func NewServiceWithConfig(config ServiceConfig) Service {
	if config.Rooms == nil || config.Occupancy == nil || config.History == nil || config.Today == nil {
		panic("facilities compatibility service: all dependencies are required")
	}
	return &service{OccupancyProjection: config.Occupancy, config: config}
}

func (s *service) CreateRoom(ctx context.Context, room *facilitiesModule.Room) error {
	if room == nil {
		return wrap("create room", errors.New("room cannot be nil"))
	}
	created, err := s.config.Rooms.CreateRoom(ctx, facilitiesModule.CreateRoom{
		Name: room.Name, Building: room.Building, Floor: room.Floor, Capacity: room.Capacity,
		Category: room.Category, Color: room.Color, IsSystem: room.IsSystem,
		IsOpenRoom: room.IsOpenRoom,
	})
	if err != nil {
		return wrap("create room", err)
	}
	*room = created
	return nil
}

func (s *service) ListRooms(ctx context.Context) ([]RoomWithOccupancy, error) {
	rooms, err := s.config.Rooms.ListRooms(ctx, facilitiesModule.RoomFilter{})
	if err != nil {
		return nil, wrap("list rooms", err)
	}
	rows, err := s.ProjectRoomOccupancy(ctx, rooms)
	return rows, wrap("list rooms", err)
}

func (s *service) FindRoomByName(ctx context.Context, name string) (*facilitiesModule.Room, error) {
	room, err := s.config.Rooms.FindRoomByName(ctx, name)
	if err != nil {
		return nil, wrap("find room by name", err)
	}
	return &room, nil
}

func (s *service) FindToiletRoom(ctx context.Context, exclude int64) (*facilitiesModule.Room, error) {
	room, err := s.config.Rooms.FindToiletRoom(ctx, exclude)
	if err != nil {
		return nil, wrap("find toilet room", err)
	}
	return &room, nil
}

func (s *service) GetAvailableRoomsWithOccupancy(ctx context.Context, capacity int) ([]RoomWithOccupancy, error) {
	// A room closed today is not available at the kiosk (#7653).
	today := s.config.Today()
	rooms, err := s.config.Rooms.ListRooms(ctx, facilitiesModule.RoomFilter{MinimumCapacity: &capacity, OpenOn: &today})
	if err != nil {
		return nil, wrap("get available rooms with occupancy", err)
	}
	rows, err := s.config.Occupancy(ctx, rooms)
	return rows, wrap("get available rooms with occupancy", err)
}

func (s *service) GetRoomHistory(ctx context.Context, roomID int64, start, end time.Time, staffID *int64) ([]facilitiesModule.RoomSessionEntry, error) {
	if _, err := s.config.Rooms.FindRoom(ctx, roomID); err != nil {
		return nil, wrap("get room history", err)
	}
	rows, err := s.config.History(ctx, roomID, start, end, staffID)
	return rows, wrap("get room history", err)
}

func wrap(operation string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("facilities error during %s: %w", operation, err)
}

// ProjectRoomOccupancy lets the immutable projection implement its read port
// directly; the service need not forward the same invocation.
func (project OccupancyProjection) ProjectRoomOccupancy(ctx context.Context, rooms []facilitiesModule.Room) ([]RoomWithOccupancy, error) {
	return project(ctx, rooms)
}
