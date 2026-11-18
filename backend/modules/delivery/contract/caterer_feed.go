package contract

import "context"

// NotificationCatererMealPlanChanged tells the caterer of a school that the
// school changed the menu of a day (#7147), so the kitchen can plan the
// quantities. It reads the notice in the bell of the caterer portal, next to
// the entries of the other schools it supplies. It follows the school switch
// of NotificationMealPlanChanged and never pushes: the caterer portal has
// neither push nor live updates.
const NotificationCatererMealPlanChanged = "caterer_meal_plan_changed"

// NotificationCatererSchoolClosingDayChanged tells the caterer of a school
// that the school entered, changed or deleted a closing day (#7147). It
// follows the school switch of NotificationSchoolClosingDayChanged and never
// pushes.
const NotificationCatererSchoolClosingDayChanged = "caterer_school_closing_day_changed"

// CatererFeedNotifier writes a notice into the bell of the caterer portal
// (#7147), in the caller's tenant transaction of the school the notice is
// about.
//
//   - CatererAudience names the active accounts of the caterer that currently
//     supplies the school of the transaction (ADR 0077); a school without a
//     running supply names nobody.
//   - NotifyCaterer writes an entry per named account in that school, with no
//     push and no live signal. The type must be a caterer feed type; its
//     school switch applies as for the staff types. The producer removes the
//     person who triggered the change before it names the accounts.
type CatererFeedNotifier interface {
	CatererAudience(ctx context.Context, tenantID int64) ([]int64, error)
	NotifyCaterer(ctx context.Context, event CatererFeedEvent) error
}

// CatererFeedEvent is one notice to a caterer: its display-safe text, its
// app-relative link in the caterer portal and the object it is about.
type CatererFeedEvent struct {
	Type        string
	TenantID    int64
	AccountIDs  []int64
	Title       string
	Body        string
	DeepLink    string
	RelatedType string
	RelatedID   int64
}

// CatererNotificationFeed serves a caterer account the bell of the caterer
// portal (#7147): the entries of the account across the schools its caterer
// currently supplies, each with its school. It opens its own administrative
// transaction; every statement keeps only those schools, and only while the
// account is an active account of the caterer. An ended supply hides the
// school's entries at once. The caterer portal has no live channel, so a
// change of the read state is announced to nobody.
type CatererNotificationFeed interface {
	Page(ctx context.Context, accountID int64, cursor string, limit int) (SchoolNotificationFeedPage, error)
	UnreadCount(ctx context.Context, accountID int64) (int, error)
	MarkRead(ctx context.Context, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, accountID int64) (int, error)
}

// SchoolNotificationFeedPage is one page of a bell across schools (Träger
// and caterer portal) with the unread count; NextCursor is empty on the last
// page.
type SchoolNotificationFeedPage = TraegerNotificationFeedPage
