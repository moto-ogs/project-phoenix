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
// into the notification feed of every account of its audience: staff accounts
// of a staff event (#7148), or guardian accounts of a guardian event about
// the children of Audience.StudentIDs (#7140). PushAccountIDs are the
// recipients the producer lets a push reach; a push follows only for a new
// entry, never for an update of a bundled unread entry.
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
//
// Title and Body are the entry's text when it may say more than the push: a
// guardian reads it only after login, while the lock-screen push stays free
// of child data. Empty values use the event's display-safe text.
type NotificationFeedDelivery struct {
	PushAccountIDs    []int64
	DeepLink          string
	HoldOutsideWindow bool
	Title             string
	Body              string
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
