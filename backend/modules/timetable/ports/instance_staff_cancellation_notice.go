package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// StaffCancellationNotice tells the staff planned for a block that it was
// cancelled (#7148). AccountIDs are the planned staff without the person who
// cancelled; Push is false for a block more than 14 days ahead, which then
// reaches the notification feed only.
type StaffCancellationNotice struct {
	InstanceID int64
	Title      string
	Date       calendar.Date
	// StartTime is the block's wall-clock start.
	StartTime  time.Time
	AccountIDs []int64
	Push       bool
}

// StaffCancellationNotices is the consumer-owned port to Delivery's
// notification feed. It writes in the caller's transaction, so the notice
// commits or rolls back with the cancellation.
type StaffCancellationNotices interface {
	NotifyInstanceCancelled(ctx context.Context, notice StaffCancellationNotice) error
}
