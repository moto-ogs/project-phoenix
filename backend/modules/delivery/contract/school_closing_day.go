package contract

import "context"

// NotificationSchoolClosingDayChanged is the notification type of a closing
// day of the school that was planned, changed or cancelled (#7144): every
// account of the school in the OGS portal and in moto schule hears about it
// in the notification feed, and by push while the change takes effect within
// 14 days and the person did not switch it off. School Calendar produces it;
// Delivery registers the type.
const NotificationSchoolClosingDayChanged = "school_closing_day_changed"

// NotificationParentSchoolClosingDayChanged is the same notice for the
// families (#7144): every guardian holding parent_portal.access for a child
// of the school. It follows the school switch of
// NotificationSchoolClosingDayChanged.
const NotificationParentSchoolClosingDayChanged = "parent_school_closing_day_changed"

// NotificationTraegerSchoolClosingDayChanged is the same notice for the
// Träger-Büro (#7146): every active member of the school's Träger reads it in
// the bell of the Träger-Portal, next to the entries of the Träger's other
// schools. It follows the school switch of
// NotificationSchoolClosingDayChanged and never pushes: the Träger-Portal has
// neither push nor live updates.
const NotificationTraegerSchoolClosingDayChanged = "traeger_school_closing_day_changed"

// SchoolAudience names everybody a notice to the whole school reaches
// (#7144), in the caller's tenant transaction of the school: the active
// accounts with a role of the OGS portal or of moto schule, and the active
// guardian accounts with the children they hold parent_portal.access for. It
// applies the conditions the notification feed, Web Push and SSE apply on
// delivery, so nobody is named who could not read the entry. It applies no
// personal choice and leaves out nobody: the producer removes the person who
// triggered the change.
type SchoolAudience interface {
	SchoolAudience(ctx context.Context, tenantID int64) (SchoolAudienceMembers, error)
}

// SchoolAudienceMembers are the accounts of one school's audience.
// StaffAccountIDs have an OGS staff role and therefore still need the
// notification type's permission. SchoolAccountIDs have a moto-schule role;
// types can explicitly waive that permission for this portal. StudentIDs are
// the children the guardians reach the notice through. TraegerAccountIDs are
// the active members of the school's Träger with an active account (#7146);
// they read the notice in the Träger-Portal.
type SchoolAudienceMembers struct {
	StaffAccountIDs    []int64
	SchoolAccountIDs   []int64
	GuardianAccountIDs []int64
	StudentIDs         []int64
	TraegerAccountIDs  []int64
}

// TraegerFeedNotifier writes a notice into the bell of the Träger-Portal
// (#7146), in the caller's tenant transaction of the school the notice is
// about: an entry per named account in that school, with no push and no live
// signal. The type must be a Träger feed type; its school switch applies as
// for the staff types. The producer removes the person who triggered the
// change before it names the accounts.
type TraegerFeedNotifier interface {
	NotifyTraeger(ctx context.Context, event TraegerFeedEvent) error
}

// TraegerFeedEvent is one notice to the Träger-Büro: its display-safe text,
// its app-relative link in the Träger-Portal and the object it is about.
type TraegerFeedEvent struct {
	Type        string
	TenantID    int64
	AccountIDs  []int64
	Title       string
	Body        string
	DeepLink    string
	RelatedType string
	RelatedID   int64
}

// TraegerNotificationFeed serves a Träger member the bell of the
// Träger-Portal (#7146): the entries of the account across the schools of the
// session's Träger, each with its school. It opens its own administrative
// transaction; every statement keeps only the schools of that Träger, and only
// while the account is an active member of it with an active account. The
// Träger-Portal has no live channel, so a change of the read state is
// announced to nobody.
type TraegerNotificationFeed interface {
	Page(ctx context.Context, organizationID, accountID int64, cursor string, limit int) (TraegerNotificationFeedPage, error)
	UnreadCount(ctx context.Context, organizationID, accountID int64) (int, error)
	MarkRead(ctx context.Context, organizationID, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, organizationID, accountID int64) (int, error)
}

// TraegerNotificationFeedPage is one page of the Träger bell with the unread
// count; NextCursor is empty on the last page.
type TraegerNotificationFeedPage struct {
	Entries     []TraegerNotificationFeedEntry
	NextCursor  string
	UnreadCount int
}

// TraegerNotificationFeedEntry is one entry of the Träger bell with the
// school it is about.
type TraegerNotificationFeedEntry struct {
	NotificationFeedEntry
	SchoolID   int64
	SchoolName string
}
