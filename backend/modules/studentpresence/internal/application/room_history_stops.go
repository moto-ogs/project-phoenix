package application

import (
	"context"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
)

// RoomHistoryStops runs the per-child stop of the room history and the mood
// capture (#3844). A stop or resume writes the stop row, the deletion of the
// completed visits and the audit event in one tenant transaction, so no
// stop exists without its evidence and no evidence without its stop.
type RoomHistoryStops struct {
	*RoomHistoryStopReads
	audit studentpresence.RoomHistoryStopAudit
	now   func() time.Time
}

// RoomHistoryStopReads reads the stops without writing any.
type RoomHistoryStopReads struct {
	store   ports.RoomHistoryStopStore
	tx      ports.Transaction
	observe func(ports.Observation)
}

var (
	_ studentpresence.RoomHistoryStops     = (*RoomHistoryStops)(nil)
	_ studentpresence.RoomHistoryStopReads = (*RoomHistoryStopReads)(nil)
)

func NewRoomHistoryStopReads(store ports.RoomHistoryStopStore, tx ports.Transaction, observe func(ports.Observation)) *RoomHistoryStopReads {
	if store == nil || tx == nil || observe == nil {
		panic("student presence room history stop reads: all dependencies are required")
	}
	return &RoomHistoryStopReads{store: store, tx: tx, observe: observe}
}

func NewRoomHistoryStops(store ports.RoomHistoryStopStore, tx ports.Transaction, audit studentpresence.RoomHistoryStopAudit, observe func(ports.Observation), now func() time.Time) *RoomHistoryStops {
	if audit == nil || now == nil {
		panic("student presence room history stops: all dependencies are required")
	}
	return &RoomHistoryStops{RoomHistoryStopReads: NewRoomHistoryStopReads(store, tx, observe), audit: audit, now: now}
}

func (s *RoomHistoryStopReads) run(ctx context.Context, operation string, fn func(context.Context) (ports.Stats, error)) error {
	started := time.Now()
	var stats ports.Stats
	err := s.tx.Run(ctx, func(txCtx context.Context) error {
		var err error
		stats, err = fn(txCtx)
		return err
	})
	s.observe(ports.Observation{Operation: operation, Duration: time.Since(started), Stats: stats, Err: err})
	return err
}

func (s *RoomHistoryStopReads) RoomHistoryStoppedSince(ctx context.Context, studentIDs []int64) (map[int64]time.Time, error) {
	var result map[int64]time.Time
	err := s.run(ctx, "list_room_history_stops", func(ctx context.Context) (ports.Stats, error) {
		if !validIDs(studentIDs) {
			return ports.Stats{}, studentpresence.ErrInvalidRoomHistoryStop
		}
		var stats ports.Stats
		var err error
		result, stats, err = s.store.ListRoomHistoryStops(ctx, studentIDs)
		return stats, err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// MoodCaptureStopped reports whether the child is stopped.
func (s *RoomHistoryStopReads) MoodCaptureStopped(ctx context.Context, studentID int64) (bool, error) {
	stops, err := s.RoomHistoryStoppedSince(ctx, []int64{studentID})
	if err != nil {
		return false, err
	}
	_, stopped := stops[studentID]
	return stopped, nil
}

func (s *RoomHistoryStops) StopRoomHistory(ctx context.Context, change studentpresence.RoomHistoryStopChange) (studentpresence.RoomHistoryStopResult, error) {
	var result studentpresence.RoomHistoryStopResult
	err := s.run(ctx, "stop_room_history", func(ctx context.Context) (ports.Stats, error) {
		if !validRoomHistoryStopChange(change) {
			return ports.Stats{}, studentpresence.ErrInvalidRoomHistoryStop
		}
		at := s.now()
		inserted, stoppedAt, stats, err := s.store.InsertRoomHistoryStop(ctx, change.StudentID, at)
		if err != nil || !inserted {
			result.StoppedAt = stoppedAt
			return stats, err
		}
		deleted, deleteStats, err := s.store.DeleteCompletedVisits(ctx, change.StudentID)
		addStats(&stats, deleteStats)
		if err != nil {
			return stats, err
		}
		result = studentpresence.RoomHistoryStopResult{Changed: true, StoppedAt: stoppedAt, DeletedVisits: deleted}
		return stats, s.audit.RecordRoomHistoryStop(ctx, studentpresence.RoomHistoryStopEvent{
			StudentID: change.StudentID, Actor: change.Actor, Stopped: true, DeletedVisits: deleted, At: at,
		})
	})
	if err != nil {
		return studentpresence.RoomHistoryStopResult{}, err
	}
	return result, nil
}

func (s *RoomHistoryStops) ResumeRoomHistory(ctx context.Context, change studentpresence.RoomHistoryStopChange) (bool, error) {
	var resumed bool
	err := s.run(ctx, "resume_room_history", func(ctx context.Context) (ports.Stats, error) {
		if !validRoomHistoryStopChange(change) {
			return ports.Stats{}, studentpresence.ErrInvalidRoomHistoryStop
		}
		var stats ports.Stats
		var err error
		resumed, stats, err = s.store.DeleteRoomHistoryStop(ctx, change.StudentID)
		if err != nil || !resumed {
			return stats, err
		}
		return stats, s.audit.RecordRoomHistoryStop(ctx, studentpresence.RoomHistoryStopEvent{
			StudentID: change.StudentID, Actor: change.Actor, Stopped: false, At: s.now(),
		})
	})
	if err != nil {
		return false, err
	}
	return resumed, nil
}

func validRoomHistoryStopChange(change studentpresence.RoomHistoryStopChange) bool {
	switch change.Actor.Source {
	case studentpresence.RoomHistoryStopSourceTenantPortal, studentpresence.RoomHistoryStopSourceParentPortal:
	default:
		return false
	}
	return change.StudentID > 0 && change.Actor.AccountID > 0 && strings.TrimSpace(change.Actor.Name) != ""
}
