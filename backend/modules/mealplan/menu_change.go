package mealplan

import "context"

// MenuChange is a changed meal plan day the families with a meal booked on it
// hear about (#7145). WeekStart is the Monday of its week: changes to the
// same week within ten minutes bundle into one notice. StudentIDs are the
// children with a meal booked on Date; ActorAccountID is the account that
// changed the plan and never hears about it. Push is false for a day more than
// 14 days ahead, which then reaches the notification feed only.
type MenuChange struct {
	Date           Date
	WeekStart      Date
	StudentIDs     []int64
	ActorAccountID int64
	Push           bool
}

// MenuChangeNotices is the consumer-owned port to Delivery's notification
// feed. It reaches the guardians of the children who hold parent_portal.access
// for them, without the actor, and writes in the caller's transaction, so the
// notice commits or rolls back with the meal plan.
type MenuChangeNotices interface {
	NotifyMenuChanged(ctx context.Context, change MenuChange) error
}

// MenuDay is what is different about lunch on a day: Changed when the menu
// changed after it was published (#7666), Cancelled when the school
// cancelled lunch (#7656), with its Reason. It names no dish.
type MenuDay struct {
	Changed   bool
	Cancelled bool
	Reason    string
}

// MenuChanges reads what is different about lunch on a day (#7666, #7656):
// the same change the families hear about. It names no dish; the menu
// itself stays on the meal plan page behind its permission. It reads in the
// caller's transaction, in one statement.
type MenuChanges interface {
	MenuDayOn(ctx context.Context, date Date) (MenuDay, error)
}
