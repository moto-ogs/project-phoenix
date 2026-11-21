package http

import (
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	notification "github.com/moto-ogs/project-phoenix/workflows/holidayclosurenotification"
)

// TraegerRouteContracts registers the Träger-Büro's list "Eltern noch nicht
// informiert" (ADR 0270), with patterns relative to
// /traeger/holiday-closures/pending.
func TraegerRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: notification.Pending{}},
		{Method: "POST", Pattern: "/notify", Portals: portals, Request: NotifyAllRequest{}, Response: notification.NotifiedPending{}},
		{Method: "POST", Pattern: "/{id}/notify", Portals: portals, Request: NotifyRequest{}, Response: notification.ClosureNotice{}},
	}
}

// NoticeResponse is a notice as the school's routes render it: the JSON of
// notification.ClosureNotice, with the revision as the count it is.
type NoticeResponse struct {
	Token        string              `json:"token"`
	ID           common.ID           `json:"id"`
	SchoolID     common.ID           `json:"school_id"`
	SchoolName   string              `json:"school_name,omitempty"`
	ClosingDayID common.ID           `json:"closing_day_id"`
	Reason       string              `json:"reason"`
	Previous     *notification.Range `json:"previous"`
	Current      *notification.Range `json:"current"`
	Revision     int                 `json:"revision"`
	Status       string              `json:"status"`
	Changed      bool                `json:"changed"`
	CanNotify    bool                `json:"can_notify"`
	Families     int                 `json:"families"`
	ConfirmedAt  *time.Time          `json:"confirmed_at"`
	UpdatedAt    time.Time           `json:"updated_at"`
}

func toNoticeResponse(n notification.ClosureNotice) NoticeResponse {
	return NoticeResponse{
		Token: n.Token, ID: n.ID, SchoolID: n.SchoolID, SchoolName: n.SchoolName, ClosingDayID: n.ClosingDayID,
		Reason: n.Reason, Previous: n.Previous, Current: n.Current, Revision: int(n.Revision), Status: n.Status,
		Changed: n.Changed, CanNotify: n.CanNotify, Families: n.Families, ConfirmedAt: n.ConfirmedAt, UpdatedAt: n.UpdatedAt,
	}
}

func toNoticeResponses(notices []notification.ClosureNotice) []NoticeResponse {
	out := make([]NoticeResponse, 0, len(notices))
	for _, n := range notices {
		out = append(out, toNoticeResponse(n))
	}
	return out
}

// SchoolRouteContracts registers the typed contract of the school's holiday
// closure notices (ADR 0270), with patterns relative to
// /api/holiday-closure-notices.
func SchoolRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []NoticeResponse{}},
		{Method: "POST", Pattern: "/{id}/notify", Portals: portals, Request: NotifyRequest{}, Response: NoticeResponse{}},
	}
}
