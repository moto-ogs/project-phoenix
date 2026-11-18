package parent

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	calendarService "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ParentCalendarResponse lists the guardian's appointments of a range of days.
type ParentCalendarResponse struct {
	From   timezone.Date           `json:"from"`
	To     timezone.Date           `json:"to"`
	Events []calendarService.Event `json:"events"`
}

// ParentCalendarFeedResponse carries the subscription addresses of the
// guardian's calendar.
type ParentCalendarFeedResponse struct {
	URL       string `json:"url"`
	WebcalURL string `json:"webcal_url"`
}

// ParentInvitationStatusResponse confirms the answer to an invitation.
type ParentInvitationStatusResponse struct {
	Status string `json:"status"`
}

// Phase kinds and audiences as Enrollment stores them. The portal reads them
// through its own port and does not import Enrollment; the root's contract
// test compares them with the owner's values.
var (
	EnrollablePhaseKinds     = []string{"school_year", "holiday", "custom"}
	EnrollablePhaseAudiences = []string{"open", "new_students", "existing_students", "linked_parents"}
)

// MeRouteContracts registers the typed contract of the guardian's own reads
// (ADR 0270), with patterns relative to the /parent mount.
func MeRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/me/calendar", Portals: portals,
			Query:    []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}},
			Response: ParentCalendarResponse{},
		},
		{
			Method: "GET", Pattern: "/me/calendar/appointments/{appointmentId}/overview", Portals: portals,
			Query:    []common.QueryParam{{Name: "occurrence_date", Kind: common.QueryDate}},
			Response: calendarService.AppointmentOverview{},
		},
		{Method: "GET", Pattern: "/me/calendar/feed", Portals: portals, Response: ParentCalendarFeedResponse{}},
		{Method: "POST", Pattern: "/me/calendar/feed/rotate", Portals: portals, Response: ParentCalendarFeedResponse{}},
		{
			Method: "POST", Pattern: "/me/calendar/recipients/{recipientId}/response", Portals: portals,
			Request: calendarService.InvitationAnswer{}, Response: ParentInvitationStatusResponse{},
		},
		{
			Method: "GET", Pattern: "/me/enrollable-schools",
			Portals:  portals,
			Response: []EnrollablePhaseResponse{},
			Enums: []common.EnumContract{
				{Name: "EnrollmentPhaseKind", Fields: []string{"EnrollablePhaseResponse.phase_kind"}, Values: EnrollablePhaseKinds},
				{Name: "EnrollmentPhaseAudience", Fields: []string{"EnrollablePhaseResponse.audience"}, Values: EnrollablePhaseAudiences},
			},
		},
	}
}
