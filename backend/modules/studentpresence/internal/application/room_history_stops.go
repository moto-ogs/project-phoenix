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
	store ports.RoomHistoryStopStore
	tx    ports.Transaction
}

var (
	_ studentpresence.RoomHistoryStops     = (*RoomHistoryStops)(nil)
	_ studentpresence.RoomHistoryStopReads = (*RoomHistoryStopReads)(nil)
)

func NewRoomHistoryStopReads(store ports.RoomHistoryStopStore, tx ports.Transaction) *RoomHistoryStopReads {
	if store == nil || tx == nil {
		panic("student presence room history stop reads: all dependencies are required")
	}
	return &RoomHistoryStopReads{store: store, tx: tx}
}

// NewRoomHistoryStopReadsOf reads the stops over the owner's own store and
// transaction, so the stop shares the owner's tenant binding.
func NewRoomHistoryStopReadsOf(owner *Service) *RoomHistoryStopReads {
	return NewRoomHistoryStopReads(owner.store, owner.tx)
}

// NewRoomHistoryStopsOf runs the stop over the owner's own store, transaction
// and clock.
func NewRoomHistoryStopsOf(owner *Service, audit studentpresence.RoomHistoryStopAudit) *RoomHistoryStops {
	return NewRoomHistoryStops(owner.store, owner.tx, audit, owner.now)
}

func NewRoomHistoryStops(store ports.RoomHistoryStopStore, tx ports.Transaction, audit studentpresence.RoomHistoryStopAudit, now func() time.Time) *RoomHistoryStops {
	if audit == nil || now == nil {
		panic("student presence room history stops: all dependencies are required")
	}
	return &RoomHistoryStops{RoomHistoryStopReads: NewRoomHistoryStopReads(store, tx), audit: audit, now: now}
}

// run executes fn in the caller's tenant transaction or its own. Failures
// return to the caller; the request log records them.
func (s *RoomHistoryStopReads) run(ctx context.Context, _ string, fn func(context.Context) (ports.Stats, error)) error {
	return s.tx.Run(ctx, func(txCtx context.Context) error {
		_, err := fn(txCtx)
		return err
	})
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
