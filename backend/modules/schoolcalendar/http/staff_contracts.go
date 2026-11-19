package staffcalendarhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	calendarService "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// StaffCalendarResponse is the staff member's own calendar for a range of
// days.
type StaffCalendarResponse struct {
	From   timezone.Date           `json:"from"`
	To     timezone.Date           `json:"to"`
	Events []calendarService.Event `json:"events"`
}

// StaffCalendarAccessResponse carries the subscription addresses of the
// staff calendar and, where the school offers it, the CalDAV access.
type StaffCalendarAccessResponse struct {
	URL       string                     `json:"url"`
	WebcalURL string                     `json:"webcal_url"`
	CalDAV    *StaffCalDAVAccessResponse `json:"caldav"`
}

// StaffCalDAVAccessResponse is the CalDAV account of the staff calendar.
type StaffCalDAVAccessResponse struct {
	ServerURL   string `json:"server_url"`
	Username    string `json:"username"`
	AppPassword string `json:"app_password"`
}

func staffCalendarAccessResponse(access calendarService.StaffCalendarAccessInfo) StaffCalendarAccessResponse {
	out := StaffCalendarAccessResponse{URL: access.URL, WebcalURL: access.WebcalURL}
	if access.CalDAV != nil {
		out.CalDAV = &StaffCalDAVAccessResponse{
			ServerURL:   access.CalDAV.ServerURL,
			Username:    access.CalDAV.Username,
			AppPassword: access.CalDAV.AppPassword,
		}
	}
	return out
}

// StaffRouteContracts registers the typed contract of the staff calendar
// (ADR 0270), with patterns relative to /api/calendar. The iCalendar file of
// one appointment keeps its route file.
func StaffRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	days := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	occurrence := []common.QueryParam{{Name: "occurrence_date", Kind: common.QueryDate}}
	search := []common.QueryParam{{Name: "q", Kind: common.QueryString}, {Name: "limit", Kind: common.QueryInt}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/my", Portals: portals, Query: days, Response: StaffCalendarResponse{}},
		{Method: "GET", Pattern: "/feed", Portals: portals, Response: StaffCalendarAccessResponse{}},
		{Method: "POST", Pattern: "/feed/rotate", Portals: portals, Response: StaffCalendarAccessResponse{}},
		{Method: "GET", Pattern: "/appointments/{appointmentId}/overview", Portals: portals, Query: occurrence, Response: calendarService.AppointmentOverview{}},
		{Method: "POST", Pattern: "/appointments", Portals: portals, Request: createAppointmentRequest{}, Response: calendarService.AppointmentDetail{}},
		{Method: "GET", Pattern: "/appointments/{appointmentId}", Portals: portals, Response: calendarService.AppointmentDetail{}},
		{Method: "GET", Pattern: "/appointments/{appointmentId}/mails", Portals: portals, Response: calendarService.AppointmentMails{}},
		{Method: "PUT", Pattern: "/appointments/{appointmentId}", Portals: portals, Request: updateAppointmentRequest{}, Response: calendarService.AppointmentDetail{}},
		{Method: "DELETE", Pattern: "/appointments/{appointmentId}", Portals: portals, Response: CalendarStatusResponse{}},
		{Method: "POST", Pattern: "/appointments/{appointmentId}/cancel", Portals: portals, Response: calendarService.AppointmentDetail{}},
		{Method: "POST", Pattern: "/appointments/{appointmentId}/occurrences/{occurrenceDate}/cancel", Portals: portals, Response: CalendarStatusResponse{}},
		{Method: "POST", Pattern: "/recipients/{recipientId}/response", Portals: portals, Request: calendarService.InvitationAnswer{}, Response: CalendarStatusResponse{}},
		{Method: "GET", Pattern: "/recipient-options", Portals: portals, Query: search, Response: calendarService.RecipientOptions{}},
	}
}
