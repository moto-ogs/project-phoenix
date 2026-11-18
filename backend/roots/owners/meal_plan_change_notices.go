package owners

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/modules/delivery/devices"
	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// mealPlanChangeDeepLink is the meal plan of the parents portal. A parent
// account can belong to several schools, so the link identifies the affected
// school as well as the changed week.
const mealPlanChangeDeepLink = "/meal-plan?week=%s&school=%d"

// mealPlanChangeRelatedType is the object a menu change notice is about: the
// week, so changes to several days of one week bundle into one entry.
const mealPlanChangeRelatedType = "meal_plan_week"

// mealPlanChangePreferences narrows the push of a changed menu to who
// switched the type on: it is off by default (#7145).
type mealPlanChangePreferences interface {
	FilterOptedIn(ctx context.Context, notificationType string, accountIDs []int64) ([]int64, error)
}

// mealPlanChangeNotices binds the Meal Plan's notice about a changed menu
// (#7145) to the guardians of the booked children and to Delivery's
// notification feed: every guardian holding parent_portal.access for one of
// the children gets a feed entry about them, and a push follows in the
// guardian's language for who switched the type on, while the day lies within
// the push window the Meal Plan decided. The caterer that supplies the school
// reads the change in the bell of the caterer portal, without push (#7147).
type mealPlanChangeNotices struct {
	guardians   peopledirectory.GuardianPortalContacts
	notifier    staffPushRouter
	preferences mealPlanChangePreferences
	// caterer writes the entry of the caterer bell (#7147); nil leaves the
	// caterer out.
	caterer catererFeedNotifier
	now     func() time.Time
}

// NewMealPlanChangeNotices binds the notices over the school's guardians and
// the root's notifications. Without Delivery's notifications it is nil, and
// the Meal Plan tells nobody.
func NewMealPlanChangeNotices(guardians peopledirectory.GuardianPortalContacts, notifications DeliveryNotifications) mealplanModule.MenuChangeNotices {
	if guardians == nil || notifications.Notifier == nil || notifications.Preferences == nil {
		return nil
	}
	return mealPlanChangeNotices{guardians: guardians, notifier: notifications.Notifier, preferences: notifications.Preferences,
		caterer: notifications.CatererNotices, now: time.Now}
}

// mealPlanChangeAudience is the guardians of one language with the booked
// children each of them holds parent_portal.access for.
type mealPlanChangeAudience struct {
	accounts []int64
	students []int64
}

// audience groups the guardians with parent_portal.access to a booked child
// by their portal language, without the actor. One read serves all children.
func (n mealPlanChangeNotices) audience(ctx context.Context, change mealplanModule.MenuChange) (map[string]*mealPlanChangeAudience, []int64, error) {
	contacts, err := n.guardians.ListGuardianPortalContacts(ctx, nil, change.StudentIDs)
	if err != nil {
		return nil, nil, fmt.Errorf("meal plan change: list guardians: %w", err)
	}
	byLocale := make(map[string]*mealPlanChangeAudience)
	var accounts []int64
	policy := deliveryPolicy.ParentDeliveryPolicy{}
	for _, contact := range contacts {
		if contact.StudentID == nil || contact.AccountID <= 0 || contact.AccountID == change.ActorAccountID ||
			!slices.Contains(change.StudentIDs, *contact.StudentID) {
			continue
		}
		granted, err := guardianPortalAccessGranted(contact.PortalPermission)
		if err != nil {
			return nil, nil, fmt.Errorf("meal plan change: %w", err)
		}
		if !granted {
			continue
		}
		locale := policy.DefaultLocale()
		if contact.PortalLocale != nil {
			locale = policy.NormalizeLocale(*contact.PortalLocale)
		}
		group := byLocale[locale]
		if group == nil {
			group = &mealPlanChangeAudience{}
			byLocale[locale] = group
		}
		group.accounts = appendUnique(group.accounts, contact.AccountID)
		group.students = appendUnique(group.students, *contact.StudentID)
		accounts = appendUnique(accounts, contact.AccountID)
	}
	return byLocale, accounts, nil
}

func (n mealPlanChangeNotices) NotifyMenuChanged(ctx context.Context, change mealplanModule.MenuChange) error {
	week, err := calendar.ParseDate(string(change.WeekStart))
	if err != nil {
		return fmt.Errorf("meal plan change: week: %w", err)
	}
	if err := n.notifyCaterer(ctx, change, week); err != nil {
		return err
	}
	byLocale, accounts, err := n.audience(ctx, change)
	if err != nil || len(accounts) == 0 {
		return err
	}
	var push []int64
	if change.Push {
		if push, err = n.preferences.FilterOptedIn(ctx, deliveryContract.NotificationMealPlanChanged, accounts); err != nil {
			return fmt.Errorf("meal plan change: filter recipients: %w", err)
		}
	}
	parentPolicy := deliveryPolicy.ParentDeliveryPolicy{}
	locales := make([]string, 0, len(byLocale))
	for locale := range byLocale {
		locales = append(locales, locale)
	}
	slices.Sort(locales)
	// A change is a notice of its own; the moment keeps it apart from an
	// earlier change of the same week.
	moment := n.now().UnixNano()
	for _, locale := range locales {
		group := byLocale[locale]
		pushTitle, pushBody := parentPolicy.ParentMealPlanChangedCopy(locale)
		feedTitle, feedBody := parentPolicy.ParentMealPlanChangedFeedCopy(locale, week)
		err := n.notifier.Notify(ctx, deliveryCompose.NotificationEvent{
			Type:           deliveryContract.NotificationMealPlanChanged,
			IdempotencyKey: fmt.Sprintf("meal_plan_changed:%s:%s:%d", change.Date, locale, moment),
			RelatedType:    mealPlanChangeRelatedType, RelatedID: mealPlanWeekID(week),
			Title: pushTitle, Body: pushBody, DeepLink: fmt.Sprintf(mealPlanChangeDeepLink, week.String(), tenant.FromContext(ctx)), Priority: "normal",
			Audience: deliveryCompose.NotificationAudience{
				TenantID: tenant.FromContext(ctx), Scope: deliveryCompose.NotificationAudienceScope("guardian"),
				GuardianAccountIDs: group.accounts, StudentIDs: group.students,
			},
			Feed: &deliveryContract.NotificationFeedDelivery{
				PushAccountIDs: slices.DeleteFunc(slices.Clone(group.accounts), func(id int64) bool { return !slices.Contains(push, id) }),
				Title:          feedTitle, Body: feedBody,
			},
		})
		if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("meal plan change: %w", err)
		}
	}
	return nil
}

// notifyCaterer tells the caterer that supplies the school about the changed
// week (#7147). Like the families' entry it is about the week, so changes to
// several days of one week bundle into one entry while it is unread.
func (n mealPlanChangeNotices) notifyCaterer(ctx context.Context, change mealplanModule.MenuChange, week calendar.Date) error {
	title, body := catererMealPlanChangedCopy(week)
	if err := notifyCaterer(ctx, n.caterer, catererFeedNotice{
		Type: deliveryContract.NotificationCatererMealPlanChanged, TenantID: tenant.FromContext(ctx), ActorID: change.ActorAccountID,
		Title: title, Body: body, RelatedType: mealPlanChangeRelatedType, RelatedID: mealPlanWeekID(week),
	}); err != nil {
		return fmt.Errorf("meal plan change: %w", err)
	}
	return nil
}

// catererMealPlanChangedCopy is the caterer's entry about a changed week:
// which week, and what to check. It names no child; the caterer portal is
// German only.
func catererMealPlanChangedCopy(monday calendar.Date) (string, string) {
	return "Speiseplan geändert", fmt.Sprintf(
		"Die Schule hat den Speiseplan für die Woche vom %s bis %s geändert. Bitte prüfe deine Planung.",
		monday.Format("02.01."), monday.AddDays(4).Format("02.01.2006"))
}

// mealPlanWeekID is the object ID of a week: its Monday as YYYYMMDD.
func mealPlanWeekID(monday calendar.Date) int64 {
	var id int64
	for _, digit := range strings.ReplaceAll(monday.String(), "-", "") {
		id = id*10 + int64(digit-'0')
	}
	return id
}

func appendUnique(ids []int64, id int64) []int64 {
	if slices.Contains(ids, id) {
		return ids
	}
	return append(ids, id)
}
