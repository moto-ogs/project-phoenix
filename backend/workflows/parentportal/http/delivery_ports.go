package parent

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// PushSubscriptions manages only the authenticated parent's devices.
// A parent device is registered once, regardless of school mappings.
type PushSubscriptions interface {
	PublicKey() (string, error)
	SubscribeParent(context.Context, int64, PushSubscriptionInput) error
	UnsubscribeParent(context.Context, int64, string) error
}

// PushSubscriptionInput is the device information this adapter accepts.
type PushSubscriptionInput struct {
	Endpoint      string
	P256dh        string
	Auth          string
	UserAgent     string
	TokenFamilyID string
}

// NotificationPreferences reads and writes the parent's cross-school decisions.
type NotificationPreferences interface {
	GetForParent(context.Context, int64) (*ParentPreferenceOverview, error)
	SetForParent(context.Context, int64, string, bool) error
	DisableAllForParent(context.Context, int64) error
}

// ParentPreferenceOverview preserves the parent's notification preference response.
type ParentPreferenceOverview struct {
	TenantEnabled bool                    `json:"tenant_enabled"`
	Types         []ParentPreferenceState `json:"types"`
}

// ParentPreferenceState is one notification choice displayed by the portal.
type ParentPreferenceState struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Group       string `json:"group"`
	Enabled     bool   `json:"enabled"`
	Available   bool   `json:"available"`
}

// NotificationFeed is the notification feed of the guardian account across
// the schools of the family (#7140). It keeps only the entries about children
// the account still holds parent_portal.access for, on every call.
type NotificationFeed interface {
	Page(ctx context.Context, accountID int64, cursor string, limit int) (FeedPage, error)
	UnreadCount(ctx context.Context, accountID int64) (int, error)
	MarkRead(ctx context.Context, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, accountID int64) (int, error)
	// IsNotFound answers an entry the account may not read; IsInvalidCursor
	// a cursor the feed did not issue.
	IsNotFound(error) bool
	IsInvalidCursor(error) bool
}

// FeedPage is one page of the feed with the unread count; NextCursor is
// empty on the last page.
type FeedPage struct {
	Entries     []FeedEntry
	NextCursor  string
	UnreadCount int
}

// FeedEntry is one entry of the feed: finished text and an app-relative link.
type FeedEntry struct {
	ID        ident.ID
	Type      string
	Title     string
	Body      string
	DeepLink  string
	CreatedAt time.Time
	UpdatedAt time.Time
	ReadAt    *time.Time
}

// PWAUsage records standalone usage across the parent's active schools.
type PWAUsage interface {
	ReportParent(context.Context, int64) error
}

// These error identities are translated by the root without changing diagnostics.
var (
	ErrWebPushNotConfigured    = errors.New("web push is not configured on this server")
	ErrInvalidPushSubscription = errors.New("invalid push subscription")
	ErrUnknownNotificationType = errors.New("unknown notification type")
)
