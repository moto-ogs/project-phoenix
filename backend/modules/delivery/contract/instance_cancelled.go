package contract

import (
	"context"
	"errors"
	"time"
)

// NotificationInstanceCancelled is the notification type of a cancelled
// appointment or offering (#7148): the staff of its staffing hear about it in
// their notification feed, and by push while it takes effect within 14 days.
// Timetable produces it; Delivery registers the type.
const NotificationInstanceCancelled = "instance_cancelled"

// NotificationInstanceReinstated is the notification type of a cancellation
// taken back (#7151): the block takes place after all. It reaches the same
// people as the cancellation, follows the cancellation's school switch,
// personal switch and 14-day push window, so it pushes whenever the
// cancellation pushed.
const NotificationInstanceReinstated = "instance_reinstated"

// NotificationFeedDelivery asks the notification router to write an event
// into the notification feed of every staff account of its audience (#7148).
// PushAccountIDs are the recipients the producer lets a push reach; a push
// follows only for an entry that is new, never for an update of a bundled
// unread entry.
type NotificationFeedDelivery struct {
	PushAccountIDs []int64
}

// NotificationFeed serves an account its own notification feed in the
// school of the request's tenant transaction (#7148). The portal is the one
// the session belongs to, "staff" or "school" (#7139): it shows the types the
// catalogue offers there, with their link in that portal, and only while the
// account holds a role of that portal. An unknown portal is an error.
type NotificationFeed interface {
	Page(ctx context.Context, tenantID, accountID int64, portal, cursor string, limit int) (NotificationFeedPage, error)
	UnreadCount(ctx context.Context, tenantID, accountID int64, portal string) (int, error)
	MarkRead(ctx context.Context, tenantID, accountID int64, portal string, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, tenantID, accountID int64, portal string) (int, error)
}

// NotificationFeedPage is one page of the feed with the unread count;
// NextCursor is empty on the last page.
type NotificationFeedPage struct {
	Entries     []NotificationFeedEntry
	NextCursor  string
	UnreadCount int
}

// NotificationFeedEntry is one entry as the owner of the feed reads it;
// DeepLink is the link in the portal it was read in.
type NotificationFeedEntry struct {
	ID        int64
	Type      string
	Title     string
	Body      string
	DeepLink  string
	CreatedAt time.Time
	UpdatedAt time.Time
	ReadAt    *time.Time
}

// ErrNotificationFeedEntryNotFound answers an entry that is not the caller's
// in this school; ErrInvalidNotificationFeedCursor a cursor the feed did not
// issue.
var (
	ErrNotificationFeedEntryNotFound = errors.New("notification feed entry not found")
	ErrInvalidNotificationFeedCursor = errors.New("invalid notification feed cursor")
)
