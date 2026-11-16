// Package contractspike is throwaway code for the generator spike of #2342.
// It is not wired into the server and must not be merged.
package contractspike

import (
	careplanhttp "github.com/moto-ogs/project-phoenix/modules/careplan/http"
	files "github.com/moto-ogs/project-phoenix/modules/filestorage/http/files"
	presenceprojectionhttp "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// PortalScope names the portal whose proxy may reach a route.
type PortalScope string

const PortalTenant PortalScope = "tenant"

// RouteContract is the typed registration of one route: what
// api.Route{Method, Pattern} lacks today. Request and Response are zero values
// of the Go types the handler binds and renders.
type RouteContract struct {
	Method  string
	Pattern string
	Portals []PortalScope
	// Request is the bound body type, nil for a route without a body.
	Request any
	// Response is the type of the envelope's data member.
	Response any
	// Paginated says the route answers through common.RespondPaginated.
	Paginated bool
	// Variants replaces Response when a query parameter selects the wire shape.
	Variants *ResponseVariants
}

// ResponseVariants describes a response whose shape the request selects.
// The payload carries no discriminator.
type ResponseVariants struct {
	QueryParam string
	Default    string
	ByValue    map[string]any
}

// Routes registers the pilot: three student read routes of the tenant portal,
// with the real response types, unchanged.
func Routes() []RouteContract {
	return []RouteContract{
		{
			Method: "GET", Pattern: "/api/students/", Portals: []PortalScope{PortalTenant},
			Paginated: true,
			Variants: &ResponseVariants{
				QueryParam: "view", Default: presenceprojectionhttp.StudentListViewFull,
				ByValue: map[string]any{
					presenceprojectionhttp.StudentListViewFull:  []presenceprojectionhttp.StudentResponse{},
					presenceprojectionhttp.StudentListViewSlim:  []presenceprojectionhttp.SlimStudentResponse{},
					presenceprojectionhttp.StudentListViewNames: []presenceprojectionhttp.NameStudentResponse{},
				},
			},
		},
		{
			Method: "GET", Pattern: "/api/students/{id}", Portals: []PortalScope{PortalTenant},
			Response: presenceprojectionhttp.StudentDetailResponse{},
		},
		{
			Method: "GET", Pattern: "/api/students/{id}/pickup-schedules", Portals: []PortalScope{PortalTenant},
			Response: careplanhttp.PickupDataResponse{},
		},
	}
}

// StringIDProbe is what a newly registered route would send: the identifier as
// a JSON string. No existing route uses it; it exists to measure the string
// path, including the maximum int64.
type StringIDProbe struct {
	ID        int64   `json:"id,string"`
	PersonID  *int64  `json:"person_id,string"`
	GroupID   int64   `json:"group_id,omitempty,string"`
	FirstName string  `json:"first_name"`
	Friends   []int64 `json:"friend_ids"`
}

// Probes are real types outside the three routes that carry the custom
// marshalers the pilot types do not use (calendar.Date, common.JSONID), plus
// the string-id probe. They are generated as bare schemas without a route.
func Probes() []any {
	return []any{
		studentpresence.DailyAttendanceStatus{}, // calendar.Date, *time.Time without omitempty
		files.FolderRequest{},                   // []common.JSONID in a request body
		files.FolderResponse{},                  // id already a string, int64 that is a count
		StringIDProbe{},
	}
}
