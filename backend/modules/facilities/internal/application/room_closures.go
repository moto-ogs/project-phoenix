package application

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Closures owns the room closures (#7653) in the caller's tenant
// transaction, like every room operation of the Service.
type Closures struct {
	service *Service
	store   ports.ClosureStore
	today   func() calendar.Date
}

// NewClosures wires the closures beside the room service; today is the
// school day of the root's clock.
func NewClosures(service *Service, store ports.ClosureStore, today func() calendar.Date) *Closures {
	if service == nil || store == nil || today == nil {
		panic("facilities application: all closure dependencies are required")
	}
	return &Closures{service: service, store: store, today: today}
}

// CloseRoom closes a room of the school for the days StartDate through
// EndDate. An archived room cannot be closed; a period that ended before
// today closes nothing and is refused.
func (c *Closures) CloseRoom(ctx context.Context, input facilities.CloseRoom) (result facilities.RoomClosure, err error) {
	if err := c.service.requireTenant(ctx, "close_room"); err != nil {
		return facilities.RoomClosure{}, err
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if err := validateClosure(input, c.today()); err != nil {
		c.service.ObserveRejection("close_room", 0, err)
		return facilities.RoomClosure{}, err
	}
	err = c.service.runWrite(ctx, "close_room", func(txCtx context.Context, stats *domain.OperationStats) error {
		room, found, queryStats, err := c.service.store.FindByID(txCtx, input.RoomID, "KEY SHARE")
		stats.Add(queryStats)
		if err != nil {
			return err
		}
		if !found {
			return facilities.ErrRoomNotFound
		}
		if room.ArchivedAt != nil {
			return facilities.ErrRoomArchived
		}
		result, queryStats, err = c.store.InsertClosure(txCtx, input)
		stats.Add(queryStats)
		return err
	})
	return result, err
}

// ReopenRoom lifts a closure of the room by deleting it.
func (c *Closures) ReopenRoom(ctx context.Context, roomID, closureID int64) error {
	if err := c.service.requireTenant(ctx, "reopen_room"); err != nil {
		return err
	}
	if roomID <= 0 || closureID <= 0 {
		err := facilities.ErrRoomClosureNotFound
		c.service.ObserveRejection("reopen_room", 0, err)
		return err
	}
	return c.service.runWrite(ctx, "reopen_room", func(txCtx context.Context, stats *domain.OperationStats) error {
		deleted, queryStats, err := c.store.DeleteClosure(txCtx, roomID, closureID)
		stats.Add(queryStats)
		if err != nil {
			return err
		}
		if !deleted {
			return facilities.ErrRoomClosureNotFound
		}
		return nil
	})
}

// ListRoomClosures reads the closures that overlap the filter's days.
func (c *Closures) ListRoomClosures(ctx context.Context, filter facilities.RoomClosureFilter) (result []facilities.RoomClosure, err error) {
	if err := c.service.requireTenant(ctx, "list_room_closures"); err != nil {
		return nil, err
	}
	if filter.From.IsZero() || filter.Until.IsZero() || filter.Until.Before(filter.From) ||
		filter.From.DaysUntil(filter.Until) >= facilities.RoomClosureMaxDays {
		err := fmt.Errorf("%w: the window runs from a day to a later one within %d days", facilities.ErrInvalidRoomClosure, facilities.RoomClosureMaxDays)
		c.service.ObserveRejection("list_room_closures", 0, err)
		return nil, err
	}
	err = c.service.runWrite(ctx, "list_room_closures", func(txCtx context.Context, stats *domain.OperationStats) error {
		closures, queryStats, err := c.store.ListClosures(txCtx, filter)
		stats.Add(queryStats)
		result = closures
		return err
	})
	return result, err
}

// RoomClosedOn reports whether the school closed the room on the day: the
// kiosk's session start refuses such a room (#7653). Session starts do not
// create a planned appointment, so they need the current verdict but not the
// exclusive room lock that timetable writes take below.
func (c *Closures) RoomClosedOn(ctx context.Context, roomID int64, day calendar.Date) (closed bool, err error) {
	closures, err := c.ListRoomClosures(ctx, facilities.RoomClosureFilter{RoomID: &roomID, From: day, Until: day})
	return len(closures) > 0, err
}

// RoomClosureRanges locks the named rooms before reading their closures in
// one statement. The exclusive lock serializes appointment writes with a
// concurrent CloseRoom, which holds KEY SHARE while it inserts the closure:
// the writer that waits then sees the closure and is refused. The list stays
// set-based for materialization.
func (c *Closures) RoomClosureRanges(ctx context.Context, roomIDs []int64, from, until calendar.Date) (result []facilities.RoomClosure, err error) {
	if err := c.service.requireTenant(ctx, "room_closed_on"); err != nil {
		return nil, err
	}
	if len(roomIDs) == 0 || from.IsZero() || until.IsZero() || until.Before(from) {
		return []facilities.RoomClosure{}, nil
	}
	ids := uniquePositiveRoomIDs(roomIDs)
	if len(ids) == 0 {
		return []facilities.RoomClosure{}, nil
	}
	err = c.service.runWrite(ctx, "room_closure_ranges", func(txCtx context.Context, stats *domain.OperationStats) error {
		closures, queryStats, err := c.store.ListClosuresWithRoomLocks(txCtx, facilities.RoomClosureFilter{RoomIDs: ids, From: from, Until: until})
		stats.Add(queryStats)
		result = closures
		return err
	})
	return result, err
}

func uniquePositiveRoomIDs(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func validateClosure(input facilities.CloseRoom, today calendar.Date) error {
	switch {
	case input.RoomID <= 0:
		return fmt.Errorf("%w: room ID is required", facilities.ErrInvalidRoomClosure)
	case input.StartDate.IsZero() || input.EndDate.IsZero():
		return fmt.Errorf("%w: start and end date are required", facilities.ErrInvalidRoomClosure)
	case input.EndDate.Before(input.StartDate):
		return fmt.Errorf("%w: the end date lies before the start date", facilities.ErrInvalidRoomClosure)
	case input.EndDate.Before(today):
		return fmt.Errorf("%w: the period ended before today", facilities.ErrInvalidRoomClosure)
	case input.StartDate.DaysUntil(input.EndDate) >= facilities.RoomClosureMaxDays:
		return fmt.Errorf("%w: a closure lasts at most %d days", facilities.ErrInvalidRoomClosure, facilities.RoomClosureMaxDays)
	case input.Reason == "":
		return fmt.Errorf("%w: the reason is required", facilities.ErrInvalidRoomClosure)
	case utf8.RuneCountInString(input.Reason) > facilities.RoomClosureReasonMaxLength:
		return fmt.Errorf("%w: the reason has at most %d characters", facilities.ErrInvalidRoomClosure, facilities.RoomClosureReasonMaxLength)
	}
	return nil
}
