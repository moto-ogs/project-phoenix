package devices

import "context"

// NotificationAudience retains every authorization and portal selector.
type NotificationAudience struct {
	TenantID           int64
	Scope              string
	GuardianAccountID  int64
	GuardianAccountIDs []int64
	ActiveGroupID      string
	StaffAccountIDs    []int64
	StudentIDs         []int64
}

// NotificationEvent is the complete producer input to the existing router.
type NotificationEvent struct {
	Type           string
	IdempotencyKey string
	RelatedType    string
	RelatedID      int64
	Audience       NotificationAudience
	Priority       string
	Title          string
	Body           string
	DeepLink       string
	SchoolDeepLink string
	Data           map[string]string
	Portal         string
	// Feed also writes the event into the notification feed of its audience
	// (#7148, #7140); nil leaves the feed untouched.
	Feed *NotificationFeed
}

// NotificationFeed asks the router for a feed entry next to the push: the
// recipients a push may reach, and the entry's own text when it may say more
// than the lock-screen push. Empty text takes the event's.
type NotificationFeed struct {
	PushAccountIDs []int64
	Title          string
	Body           string
}

// NotificationCommands dispatches through the same bound Delivery router.
type NotificationCommands interface {
	NotifyEvent(context.Context, NotificationEvent) error
	NotifyEventDurably(context.Context, NotificationEvent) (int, error)
}

// NotificationSeriesCommands sends several events in order, each exactly as
// its own NotifyEvent or NotifyEventDurably call, with one device read for
// the guardians of all of them (#5869). The first error ends the series.
type NotificationSeriesCommands interface {
	// NotifyEvents returns how many events were accepted before the error.
	NotifyEvents(context.Context, []NotificationEvent) (int, error)
	// NotifyEventsDurably returns the receipt of each event accepted before
	// the error.
	NotifyEventsDurably(context.Context, []NotificationEvent) ([]int, error)
}
