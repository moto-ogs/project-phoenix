package studentpresencehttp

import (
	common "github.com/moto-ogs/project-phoenix/api/common"
	studentpresence "github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// StatusDaysBulkCreatedResponse counts what a bulk status-day write covered.
type StatusDaysBulkCreatedResponse struct {
	StudentCount int `json:"student_count"`
	DateCount    int `json:"date_count"`
}

// StatusDayDeletedResponse confirms a removed status day.
type StatusDayDeletedResponse struct {
	Deleted bool `json:"deleted"`
}

// StudentRouteContracts registers the typed contract of the status-day
// writes, the privacy consent and the web check-in (ADR 0270), with patterns
// relative to /api/students. The proxy bounds the batch check-in's body at
// the backend's own limit, so an oversized payload never reaches it.
func StudentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/status-days/bulk", Portals: portals, Request: BulkCreateStudentStatusDaysRequest{}, Response: StatusDaysBulkCreatedResponse{}},
		{Method: "POST", Pattern: "/{id}/status-days", Portals: portals, Request: CreateStudentStatusDaysRequest{}, Response: []studentpresence.StudentStatusDayResponse{}},
		{Method: "DELETE", Pattern: "/{id}/status-days/{statusDayId}", Portals: portals, Response: StatusDayDeletedResponse{}},
		{Method: "GET", Pattern: "/privacy-consent/defaults", Portals: portals, Response: PrivacyConsentDefaultsResponse{}},
		{Method: "GET", Pattern: "/{id}/privacy-consent", Portals: portals, Response: PrivacyConsentResponse{}},
		{Method: "PUT", Pattern: "/{id}/privacy-consent", Portals: portals, Request: PrivacyConsentRequest{}, Response: PrivacyConsentResponse{}},
		{Method: "POST", Pattern: "/{id}/school-checkin", Portals: portals, Request: schoolCheckinRequest{}, Response: schoolCheckinResponse{}},
		{
			Method: "POST", Pattern: "/school-checkin/batch", Portals: portals, MaxBodyBytes: maxSchoolCheckinBatchBytes,
			Request: schoolCheckinBatchRequest{}, Response: schoolCheckinBatchResponse{},
		},
	}
}
