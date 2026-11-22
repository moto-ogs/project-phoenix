package api

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	peopleStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/peopledirectory/inbound/students"
)

// outsideContractMounts are the catalog lines the root mounts for callers
// other than the portals (#7808): the kiosk, calendar apps, Prometheus, the
// probes, the event streams, the data return and the mail provider. Each
// names a reason of the closed set and why it applies; the contract types
// none of them, and contract.json lists them under "outside".
func outsideContractMounts() []contractMount {
	return []contractMount{
		{"/api/iot", common.OutsideRoutes(common.OutsideDevice, "PyrePortal authenticates with the device key and staff PIN and reads numeric IDs (v1.11.5)",
			"GET /activities", "GET /config", "GET /rfid/{tagId}", "GET /rooms/available", "GET /school-name",
			"GET /session/current", "GET /students", "GET /teachers/",
			"POST /attendance/toggle", "POST /checkin", "POST /error-reports", "POST /feedback", "POST /move-to-room",
			"POST /pickup-query", "POST /ping", "POST /session/activity", "POST /session/end", "POST /session/start",
			"POST /staff-clock", "POST /staff-clock/state", "POST /staff/{staffId}/rfid", "DELETE /staff/{staffId}/rfid",
			"PUT /session/{sessionId}/supervisors")},
		{"/api/students", peopleStudentsHTTP.DeviceRouteContracts()},
		{"", common.OutsideRoutes(common.OutsideWebDAV, "CalDAV clients send PROPFIND and REPORT with XML", everyMethod("/api/caldav", "/api/caldav/*")...)},
		{"", common.OutsideRoutes(common.OutsideWebDAV, "RFC 6764 discovery redirects every method", everyMethod("/.well-known/caldav")...)},
		{"", common.OutsideRoutes(common.OutsideMetrics, "Prometheus text exposition", everyMethod("/internal/metrics")...)},
		{"", common.OutsideRoutes(common.OutsideProbe, "the bare host answers a probe", "GET /")},
		{"", common.OutsideRoutes(common.OutsideProbe, "liveness probe", "GET /health")},
		{"", common.OutsideRoutes(common.OutsideProbe, "readiness probe", "GET /ready")},
		{"", common.OutsideRoutes(common.OutsideStream, "event stream of the staff portal", "GET /api/sse/events")},
		{"", common.OutsideRoutes(common.OutsideStream, "event stream of the parents portal", "GET /parent-sse/events")},
		{"", common.OutsideRoutes(common.OutsideStream, "event stream of moto schule", "GET /school-sse/events")},
		{"/public/data-return", common.OutsideRoutes(common.OutsidePublicAPI, "data return to the school authority, described by its own OpenAPI document",
			"GET /openapi.json", "GET /package", "GET /package/archive", "GET /register")},
		{"", common.OutsideRoutes(common.OutsideWebhook, "the mail provider posts delivery events, signed per provider", "POST /webhooks/email/delivery/{provider}")},
	}
}

// everyMethod names a catalog line per method of a handler chi mounts for
// all of them.
func everyMethod(patterns ...string) []string {
	methods := []string{"CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "QUERY", "TRACE"}
	lines := make([]string, 0, len(patterns)*len(methods))
	for _, pattern := range patterns {
		for _, method := range methods {
			lines = append(lines, method+" "+pattern)
		}
	}
	return lines
}
