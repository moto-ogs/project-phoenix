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
// into the notification feed of every account of its audience: the staff
// accounts of a staff event (#7148), or the guardian accounts of a guardian
// event about the children of Audience.StudentIDs (#7140). PushAccountIDs are
// the recipients the producer lets a push reach; a push follows only for an
// entry that is new, never for an update of a bundled unread entry.
//
// Title and Body are the text of the entry when it may say more than the
// push: a guardian reads the entry only after login, while the push shows on
// the lock screen and stays free of child data. Empty takes the event's.
type NotificationFeedDelivery struct {
	PushAccountIDs []int64
	Title          string
	Body           string
}

// NotificationFeed serves an account its own notification feed in the
// school of the request's tenant transaction (#7148).
type NotificationFeed interface {
	Page(ctx context.Context, tenantID, accountID int64, cursor string, limit int) (NotificationFeedPage, error)
	UnreadCount(ctx context.Context, tenantID, accountID int64) (int, error)
	MarkRead(ctx context.Context, tenantID, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, tenantID, accountID int64) (int, error)
}

// GuardianNotificationFeed serves a guardian account its notification feed
// across the schools of the family (#7140): the parents portal has no school
// of its own. It opens its own administrative transaction and keeps only the
// entries about children the account still holds parent_portal.access for.
// A change of the read state is announced to the account's open sessions of
// the parents portal.
type GuardianNotificationFeed interface {
	Page(ctx context.Context, accountID int64, cursor string, limit int) (NotificationFeedPage, error)
	UnreadCount(ctx context.Context, accountID int64) (int, error)
	MarkRead(ctx context.Context, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, accountID int64) (int, error)
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
