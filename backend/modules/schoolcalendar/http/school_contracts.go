package staffcalendarhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	calendarService "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SchoolCalendarResponse is the calendar of moto schule for a range of days:
// the Lehrkraft's events with the closing days, the holidays and her classes.
type SchoolCalendarResponse struct {
	From        timezone.Date                `json:"from"`
	To          timezone.Date                `json:"to"`
	Events      []calendarService.Event      `json:"events"`
	ClosingDays []calendarService.SchoolDays `json:"closing_days"`
	Holidays    []calendarService.SchoolDays `json:"holidays"`
	Classes     []string                     `json:"classes"`
}

// CalendarFeedResponse carries the subscription addresses of a calendar.
type CalendarFeedResponse struct {
	URL       string `json:"url"`
	WebcalURL string `json:"webcal_url"`
}

// CalendarStatusResponse confirms a write that answers no object.
type CalendarStatusResponse struct {
	Status string `json:"status"`
}

// SchoolRouteContracts registers the typed contract of the calendar in moto
// schule (ADR 0270), with patterns relative to /school/calendar.
func SchoolRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalSchool}
	days := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/my", Portals: portals, Query: days, Response: SchoolCalendarResponse{}},
		{Method: "GET", Pattern: "/feed", Portals: portals, Response: CalendarFeedResponse{}},
		{Method: "POST", Pattern: "/feed/rotate", Portals: portals, Response: CalendarFeedResponse{}},
		{Method: "POST", Pattern: "/appointments", Portals: portals, Request: SchoolAppointmentRequest{}, Response: calendarService.AppointmentDetail{}},
		{Method: "PUT", Pattern: "/appointments/{appointmentId}", Portals: portals, Request: SchoolAppointmentRequest{}, Response: calendarService.AppointmentDetail{}},
		{Method: "DELETE", Pattern: "/appointments/{appointmentId}", Portals: portals, Response: CalendarStatusResponse{}},
		{Method: "POST", Pattern: "/recipients/{recipientId}/response", Portals: portals, Request: calendarService.InvitationAnswer{}, Response: CalendarStatusResponse{}},
		{Method: "GET", Pattern: "/parent-conferences", Portals: portals, Response: calendarService.SchoolParentConferenceList{}},
		{Method: "POST", Pattern: "/parent-conferences", Portals: portals, Request: ParentConferenceRequest{}, Response: calendarService.ParentConferenceView{}},
		{Method: "GET", Pattern: "/parent-conferences/{conferenceId}", Portals: portals, Deprecated: true, Response: calendarService.ParentConferenceView{}},
		{Method: "PUT", Pattern: "/parent-conferences/{conferenceId}", Portals: portals, Request: ParentConferenceRequest{}, Response: calendarService.ParentConferenceView{}},
		{Method: "DELETE", Pattern: "/parent-conferences/{conferenceId}", Portals: portals, Response: CalendarStatusResponse{}},
	}
}

// TraegerClosingDayRouteContracts registers the Träger's closing-day
// calendar (#4702), with patterns relative to /traeger/closing-days. The
// change and the delete of one day keep their route file: the delete
// forwards the holiday bookings token of the query. The export answers a
// file (#2352).
func TraegerClosingDayRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	days := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: days, Response: traegercalendar.Calendar{}},
		{Method: "GET", Pattern: "/export", Portals: portals, Query: append([]common.QueryParam{common.ListFormatQuery}, days...), File: true},
		{Method: "POST", Pattern: "/", Portals: portals, Request: TraegerClosingDayRequest{}, Response: traegercalendar.ClosingDay{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: TraegerClosingDayRequest{}, Response: traegercalendar.ClosingDay{}},
		{
			// The token of the preview confirms that the parents of the
			// affected holiday bookings learn of the reopened days (#6457).
			Method: "DELETE", Pattern: "/{id}", Portals: portals,
			Query:    []common.QueryParam{{Name: "holiday_bookings_token", Kind: common.QueryString}},
			Response: TraegerClosingDayDeleted{},
		},
	}
}
