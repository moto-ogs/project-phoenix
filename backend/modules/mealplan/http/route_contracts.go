package mealplan

import (
	"time"

	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
)

// ScheduleChangedResponse names the day a school's change of a child's
// regular meal days takes effect.
type ScheduleChangedResponse struct {
	EffectiveFrom string `json:"effective_from" contract:"date"`
}

// BillingMonthState is a Mensa month as the routes render it, without the
// month as computed now.
type BillingMonthState struct {
	Month        mealplanModule.Date                       `json:"month"`
	Status       mealplanModule.BillingMonthStatus         `json:"status"`
	SchoolDays   int                                       `json:"school_days"`
	ReleasedAt   *time.Time                                `json:"released_at"`
	ChildCount   int                                       `json:"child_count"`
	MealCount    int                                       `json:"meal_count"`
	AbsenceCount int                                       `json:"absence_count"`
	Children     []mealplanModule.BillingMonthChild        `json:"children"`
	Fingerprint  string                                    `json:"fingerprint"`
	Version      int                                       `json:"version"`
	Releases     []mealplanModule.BillingMonthReleaseEntry `json:"releases"`
}

// BillingMonthResponse is the JSON of mealplan.BillingMonth: the month and,
// when it differs from a release, the month as computed now (#4686).
type BillingMonthResponse struct {
	BillingMonthState
	Current *BillingMonthState `json:"current,omitempty"`
}

func billingMonthState(m mealplanModule.BillingMonth) BillingMonthState {
	return BillingMonthState{
		Month: m.Month, Status: m.Status, SchoolDays: m.SchoolDays, ReleasedAt: m.ReleasedAt, ChildCount: m.ChildCount,
		MealCount: m.MealCount, AbsenceCount: m.AbsenceCount, Children: m.Children, Fingerprint: m.Fingerprint,
		Version: m.Version, Releases: m.Releases,
	}
}

func toBillingMonthResponse(m mealplanModule.BillingMonth) BillingMonthResponse {
	response := BillingMonthResponse{BillingMonthState: billingMonthState(m)}
	if m.Current != nil {
		current := billingMonthState(*m.Current)
		response.Current = &current
	}
	return response
}

// ContractTypes are the bodies of the meal plan routes the contract
// registers (ADR 0270), lists as lists. This http role may not import the
// contract types, so the root builds the registrations from these.
type ContractTypes struct {
	Orders, DailyList, WeeklyList, ChildParticipation, ChildDay, ChildSchedule, ScheduleChanged any
	BillingMonths, BillingMonth, BillingMonthRelease                                            any
}

// RouteContractTypes names the bodies of the meal plan and Mensa month routes.
func RouteContractTypes() ContractTypes {
	return ContractTypes{
		Orders: OrdersResponse{}, DailyList: DailyListResponse{}, WeeklyList: WeeklyListResponse{},
		ChildParticipation: ChildParticipationResponse{}, ChildDay: ChildDayRequest{}, ChildSchedule: ChildScheduleRequest{},
		ScheduleChanged: ScheduleChangedResponse{},
		BillingMonths:   []mealplanModule.BillingMonthSummary{}, BillingMonth: BillingMonthResponse{},
		BillingMonthRelease: BillingMonthReleaseRequest{},
	}
}
