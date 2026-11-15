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

// NotificationFeedDelivery asks the notification router to write an event
// into the notification feed of every staff account of its audience (#7148).
// PushAccountIDs are the recipients the producer lets a push reach; a push
// follows only for an entry that is new, never for an update of a bundled
// unread entry.
//
// DeepLink replaces the event's link in the feed entry. It serves a push
// that opens the app without a link, while a feed entry always leads
// somewhere (#7137).
//
// HoldOutsideWindow is for a producer that repeats a held-back notice on its
// next run, such as the planned exits and the Nachweis reminders (#7137):
// outside the school's notification window nothing is written and the
// router answers ErrOutsideNotificationWindow, so feed entry and push arrive
// together on the repeat. Without it the feed entry is written at once and
// the push is left out.
type NotificationFeedDelivery struct {
	PushAccountIDs    []int64
	DeepLink          string
	HoldOutsideWindow bool
}

// NotificationFeed serves an account its own notification feed in the
// school of the request's tenant transaction (#7148).
type NotificationFeed interface {
	Page(ctx context.Context, tenantID, accountID int64, cursor string, limit int) (NotificationFeedPage, error)
	UnreadCount(ctx context.Context, tenantID, accountID int64) (int, error)
	MarkRead(ctx context.Context, tenantID, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, tenantID, accountID int64) (int, error)
}

// NotificationFeedPage is one page of the feed with the unread count;
// NextCursor is empty on the last page.
type NotificationFeedPage struct {
	Entries     []NotificationFeedEntry
	NextCursor  string
	UnreadCount int
}

// NotificationFeedEntry is one entry as the owner of the feed reads it.
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
