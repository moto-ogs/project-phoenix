package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	schedule "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// materializationWorld is everything a run loads once up front. The window is
// bounded (≤ 56 days), a tenant has O(dozens) of templates, O(hundreds) of
// enrollments — a single fetch per collection avoids the N+1 trap in the
// candidate loop. Room closures are one batch verdict for the window;
// existing appointments remain in place even when the room is later closed.
type materializationWorld struct {
	from, to      calendar.Date
	periods       []*schedule.CalendarPeriod
	days          timetable.NonWorkingDays
	existingIdx   map[existingKey]struct{}
	exceptionIdx  map[exceptionKey]*schedule.ActivityException
	timeframeByID map[int64]*schedule.Timeframe
	closedRooms   map[int64][]ports.RoomClosureRange
	// sickDays names the absence behind every full absence day of a staff
	// member in the window (#6292, #6847).
	sickDays map[staffDay]absenceStamp
	// weekendFollowsFriday materializes Saturday and Sunday from Friday's
	// schedules (#3921).
	weekendFollowsFriday bool
}

// loadMaterializationWorld pre-fetches the window's existing instances (an
// (activity_group_id, date, start_time) set for O(1) lookup) on top of the
// per-date rule inputs of loadOccurrenceRules.
func (s *materializationService) loadMaterializationWorld(
	ctx context.Context,
	from, to calendar.Date,
	periods []*schedule.CalendarPeriod,
	templates []*activityContract.Group,
) (*materializationWorld, error) {
	world, err := s.loadOccurrenceRules(ctx, from, to, periods)
	if err != nil {
		return nil, err
	}
	existing, err := instancesBetween(ctx, s.instanceRepo.Reads, from, to)
	if err != nil {
		return nil, &ports.ScheduleError{Op: "materialize for tenant: load existing instances", Err: err}
	}
	world.existingIdx = buildExistingIndex(existing)
	closures, err := s.roomClosures.RoomClosureRanges(ctx, materializationRoomIDs(templates, world.exceptionIdx), from, to)
	if err != nil {
		return nil, &ports.ScheduleError{Op: "materialize for tenant: load room closures", Err: err}
	}
	world.closedRooms = roomClosureRangesByRoom(closures)
	return world, nil
}

func materializationRoomIDs(templates []*activityContract.Group, exceptions map[exceptionKey]*schedule.ActivityException) []int64 {
	ids := make([]int64, 0, len(templates))
	for _, template := range templates {
		if template.PlannedRoomID != nil && *template.PlannedRoomID > 0 {
			ids = append(ids, *template.PlannedRoomID)
		}
	}
	for _, exception := range exceptions {
		if exception.RoomID != nil && *exception.RoomID > 0 {
			ids = append(ids, *exception.RoomID)
		}
	}
	return ids
}

func roomClosureRangesByRoom(closures []ports.RoomClosureRange) map[int64][]ports.RoomClosureRange {
	byRoom := make(map[int64][]ports.RoomClosureRange)
	for _, closure := range closures {
		byRoom[closure.RoomID] = append(byRoom[closure.RoomID], closure)
	}
	return byRoom
}

// loadMaterializationSickDays avoids the absence read when a run has no
// planned supervisors to copy. Its result is otherwise unchanged and still
// covers every day in the materialization window.
func loadMaterializationSickDays(
	ctx context.Context,
	reports ports.SickReportReader,
	from, to calendar.Date,
	people map[int64]templateRoster,
	world *materializationWorld,
) error {
	for _, roster := range people {
		if len(roster.supervisors) == 0 {
			continue
		}
		var err error
		world.sickDays, err = sickDaysIn(ctx, reports, daysBetween(from, to)...)
		return err
	}
	return nil
}
