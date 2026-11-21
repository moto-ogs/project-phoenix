package parent

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	calendarService "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// childWriteRouteContracts registers the guardian's writes for one child
// (#2352): one-day care changes, photo consent, meal participation,
// parent conference bookings, removing a connected account and the sick
// note, whose create answers the status days with the pending request.
func childWriteRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	child := "/me/children/{studentId}"
	meals := child + "/meal-participation"
	booking := child + "/parent-conferences/{conferenceId}/booking"
	dayRange := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: child + "/care-exception", Portals: portals, Query: dayRange, Response: []CareExceptionResponse{}},
		{Method: "POST", Pattern: child + "/care-exception", Portals: portals, Request: SubmitCareExceptionRequest{}, Response: PickupChangeRequestResponse{}},
		{
			Method: "DELETE", Pattern: child + "/care-exception", Portals: portals,
			Query: []common.QueryParam{{Name: "date", Kind: common.QueryDate}}, NoData: true,
		},
		{Method: "GET", Pattern: child + "/sick-note", Portals: portals, Query: dayRange, Response: []StatusDayResponse{}},
		{Method: "POST", Pattern: child + "/sick-note", Portals: portals, Request: SubmitSickNoteRequest{}, Response: SickNoteEnvelopeResponse{}},
		{Method: "PUT", Pattern: child + "/consents/photo", Portals: portals, Response: []ChildConsentResponse{}},
		{Method: "DELETE", Pattern: child + "/consents/photo", Portals: portals, Response: []ChildConsentResponse{}},
		{Method: "GET", Pattern: child + "/room-history-stop", Portals: portals, Response: ChildRoomHistoryStopResponse{}},
		{Method: "PUT", Pattern: child + "/room-history-stop", Portals: portals, Response: ChildRoomHistoryStopResponse{}},
		{Method: "DELETE", Pattern: child + "/room-history-stop", Portals: portals, Response: ChildRoomHistoryStopResponse{}},
		{Method: "GET", Pattern: meals, Portals: portals, Query: dayRange, Response: MealParticipationResponse{}},
		{Method: "PUT", Pattern: meals, Portals: portals, Request: ReplaceMealParticipationRequest{}, Response: MealPlanSavedResponse{}},
		{Method: "PUT", Pattern: meals + "/{date}", Portals: portals, Request: SetMealParticipationDayRequest{}, NoData: true},
		{Method: "DELETE", Pattern: meals + "/{date}", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: meals + "/weeks/{date}", Portals: portals, Request: SetMealParticipationDayRequest{}, Response: MealWeekChangeResponse{}},
		{Method: "PUT", Pattern: booking, Portals: portals, Request: parentConferenceBookingRequest{}, Response: calendarService.ParentConferenceOffer{}},
		{Method: "DELETE", Pattern: booking, Portals: portals, Response: ParentConferenceCancelledResponse{}},
		{Method: "DELETE", Pattern: child + "/related-accounts/{guardianProfileId}", Portals: portals, NoData: true},
	}
}

// accountWriteRouteContracts registers the guardian's notification choices,
// push devices, survey answers and the declarations on a care contract
// (#2352).
func accountWriteRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	preferences := "/me/notification-preferences"
	survey := "/me/news/{announcementId}/survey"
	contract := "/me/documents/{organizationId}/contracts/{contractId}"
	return []common.RouteContract{
		{Method: "GET", Pattern: preferences + "/", Portals: portals, Response: ParentPreferenceOverview{}},
		{Method: "DELETE", Pattern: preferences + "/", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: preferences + "/{type}", Portals: portals, Request: parentPreferenceRequest{}, NoData: true},
		{Method: "POST", Pattern: "/me/push/subscriptions", Portals: portals, Request: parentPushSubscriptionRequest{}, NoData: true},
		{
			Method: "DELETE", Pattern: "/me/push/subscriptions", Portals: portals,
			Query: []common.QueryParam{{Name: "endpoint", Kind: common.QueryString}}, NoData: true,
		},
		{Method: "GET", Pattern: survey, Portals: portals, Response: SurveyFormResponse{}},
		{Method: "POST", Pattern: survey, Portals: portals, Request: parentSurveyAnswersRequest{}, Response: SurveySubmittedResponse{}},
		{Method: "GET", Pattern: contract + "/family-children", Portals: portals, Response: parentService.FamilyChildren{}},
		{Method: "PUT", Pattern: contract + "/family-children", Portals: portals, Request: familyChildrenRequest{}, Response: parentService.FamilyChildren{}},
		{Method: "GET", Pattern: contract + "/notice", Portals: portals, Response: parentService.ContractNoticeOptions{}},
		{Method: "POST", Pattern: contract + "/notice", Portals: portals, Request: parentService.ContractNoticeInput{}, Response: parentService.ContractNoticeOptions{}},
		{Method: "GET", Pattern: contract + "/sepa-mandate", Portals: portals, Response: parentService.SEPAMandateView{}},
		{Method: "POST", Pattern: contract + "/sepa-mandate", Portals: portals, Request: parentService.SEPAMandateInput{}, Response: parentService.SEPAMandateView{}},
	}
}
