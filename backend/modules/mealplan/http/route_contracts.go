package mealplan

import mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"

// ScheduleChangedResponse names the day a school's change of a child's
// regular meal days takes effect.
type ScheduleChangedResponse struct {
	EffectiveFrom string `json:"effective_from" contract:"date"`
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
		BillingMonths:   []mealplanModule.BillingMonthSummary{}, BillingMonth: mealplanModule.BillingMonth{},
		BillingMonthRelease: BillingMonthReleaseRequest{},
	}
}
