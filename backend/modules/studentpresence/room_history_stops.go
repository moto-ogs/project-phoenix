package studentpresence

import (
	"context"
	"errors"
	"time"
)

// ErrInvalidRoomHistoryStop reports a stop change without a child or actor.
var ErrInvalidRoomHistoryStop = errors.New("invalid room history stop")

// Sources of a room history stop change, as the change history names them.
const (
	RoomHistoryStopSourceTenantPortal = "tenant_portal"
	RoomHistoryStopSourceParentPortal = "parent_portal"
)

// RoomHistoryStops is the per-child stop of the room history and the mood
// capture (#3844). While a child is stopped, the current room stays visible
// (its open visit), but a visit is deleted the moment it closes, and no mood
// is recorded for the child. Setting the stop deletes the child's completed
// visits at once; lifting it restores nothing and records from then on.
type RoomHistoryStops interface {
	RoomHistoryStopReads
	// StopRoomHistory stops the child's room history in the caller's tenant
	// transaction (or its own) and deletes its completed visits. Changed is
	// false when the child was already stopped; nothing is deleted again then.
	StopRoomHistory(context.Context, RoomHistoryStopChange) (RoomHistoryStopResult, error)
	// ResumeRoomHistory lifts the stop. It reports whether a stop existed.
	ResumeRoomHistory(context.Context, RoomHistoryStopChange) (bool, error)
}

// RoomHistoryStopReads tells which children are stopped. The Feedback owner
// and the device scan read it to take no mood of a stopped child.
type RoomHistoryStopReads interface {
	// RoomHistoryStoppedSince maps the listed stopped children to the start
	// of their stop; children without a stop are absent.
	RoomHistoryStoppedSince(context.Context, []int64) (map[int64]time.Time, error)
	// MoodCaptureStopped reports whether the child's mood capture is stopped.
	MoodCaptureStopped(ctx context.Context, studentID int64) (bool, error)
}

// RoomHistoryStopOwner is the composed owner's side of the stop: it reads
// the stops and builds the commands over its own store with the root's
// audit binding (#3844). The root reaches it from the composed Owner.
type RoomHistoryStopOwner interface {
	RoomHistoryStopReads
	RoomHistoryStops(RoomHistoryStopAudit) RoomHistoryStops
}

// RoomHistoryStopActor names who changed a stop, for the change history.
type RoomHistoryStopActor struct {
	AccountID int64
	Name      string
	Source    string
}

// RoomHistoryStopChange is one stop or resume request for a child.
type RoomHistoryStopChange struct {
	StudentID int64
	Actor     RoomHistoryStopActor
}

// RoomHistoryStopResult reports a stop: whether it was new, since when the
// child is stopped, and how many completed visits it deleted.
type RoomHistoryStopResult struct {
	Changed       bool
	StoppedAt     time.Time
	DeletedVisits int64
}

// RoomHistoryStopEvent is one effective stop change, written to the audit
// trail in the command's transaction: who, when, and on a stop the number of
// deleted visits. It carries no room, time or mood of the child.
type RoomHistoryStopEvent struct {
	StudentID     int64
	Actor         RoomHistoryStopActor
	Stopped       bool
	DeletedVisits int64
	At            time.Time
}

// RoomHistoryStopAudit records effective stop changes. The root binds it to
// the Audit Platform: the child's change history and, for deleted visits,
// the deletion log.
type RoomHistoryStopAudit interface {
	RecordRoomHistoryStop(context.Context, RoomHistoryStopEvent) error
}
