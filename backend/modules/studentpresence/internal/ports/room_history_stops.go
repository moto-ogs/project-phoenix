package ports

import (
	"context"
	"time"
)

// RoomHistoryStopStore persists the per-child room history stops (#3844)
// and removes a stopped child's completed visits.
type RoomHistoryStopStore interface {
	ListRoomHistoryStops(context.Context, []int64) (map[int64]time.Time, Stats, error)
	// InsertRoomHistoryStop records the stop at at; inserted is false and
	// stoppedAt the earlier start when the child was already stopped.
	InsertRoomHistoryStop(ctx context.Context, studentID int64, at time.Time) (inserted bool, stoppedAt time.Time, stats Stats, err error)
	// MoodCaptureStopped reports whether the child is stopped at this school
	// or, for a holiday guest, at its home school (#8037).
	MoodCaptureStopped(ctx context.Context, studentID int64) (bool, Stats, error)
	DeleteRoomHistoryStop(context.Context, int64) (bool, Stats, error)
	// DeleteCompletedVisits locks the child's visits, then deletes the
	// closed ones, so a visit closing concurrently is either seen here or
	// meets the committed stop in the table's trigger.
	DeleteCompletedVisits(context.Context, int64) (int64, Stats, error)
}
