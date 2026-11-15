package domain

import "time"

// FeedBundleWindow is how long an unread feed entry absorbs further changes
// of its object (#7148): a change of the same object for the same account
// and type within it updates the entry instead of adding a second one.
const FeedBundleWindow = 10 * time.Minute

// FeedEntryContent is what a producer writes into a feed entry: the finished,
// display-safe text and app-relative link, and the object the entry is about.
type FeedEntryContent struct {
	Type        string
	Title       string
	Body        string
	DeepLink    string
	RelatedType string
	RelatedID   int64
}

// FeedEntry is one entry of an account's notification feed in one school.
type FeedEntry struct {
	ID        int64
	TenantID  int64
	AccountID int64
	FeedEntryContent
	CreatedAt time.Time
	UpdatedAt time.Time
	ReadAt    *time.Time
}

// FeedCursor is the position after the last entry of a page: the feed is
// ordered by its last update, newest first, then by ID.
type FeedCursor struct {
	UpdatedAt time.Time
	ID        int64
}

// FeedWrite reports which accounts got a new entry and which had their unread
// entry updated by one publication.
type FeedWrite struct {
	Created []int64
	Updated []int64
}
