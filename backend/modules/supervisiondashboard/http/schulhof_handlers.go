package supervisiondashboardhttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// SchulhofStatusQuery supplies the courtyard status without infrastructure writes.
type SchulhofStatusQuery interface {
	Status(context.Context, int64) (*supervisiondashboard.SchulhofStatus, error)
}

// SchulhofResource handles Schulhof-specific API endpoints.
type SchulhofResource struct {
	schulhofService SchulhofStatusQuery
	currentStaff    func(context.Context) (int64, bool, error)
}

// NewSchulhofResource creates a new Schulhof resource.
func NewSchulhofResource(schulhofService SchulhofStatusQuery, currentStaff func(context.Context) (int64, bool, error)) *SchulhofResource {
	return &SchulhofResource{
		schulhofService: schulhofService,
		currentStaff:    currentStaff,
	}
}

// SchulhofStatusResponse represents the API response for Schulhof status.
type SchulhofStatusResponse struct {
	Exists            bool                     `json:"exists"`
	RoomID            *ident.ID                `json:"room_id,omitempty"`
	RoomName          string                   `json:"room_name"`
	ActivityGroupID   *ident.ID                `json:"activity_group_id,omitempty"`
	ActiveGroupID     *ident.ID                `json:"active_group_id,omitempty"`
	IsUserSupervising bool                     `json:"is_user_supervising"`
	SupervisionID     *ident.ID                `json:"supervision_id,omitempty"`
	SupervisorCount   int                      `json:"supervisor_count"`
	StudentCount      int                      `json:"student_count"`
	Supervisors       []SupervisorInfoResponse `json:"supervisors"`
}

// SupervisorInfoResponse represents supervisor information in API responses.
type SupervisorInfoResponse struct {
	ID            ident.ID `json:"id"`
	StaffID       ident.ID `json:"staff_id"`
	Name          string   `json:"name"`
	IsCurrentUser bool     `json:"is_current_user"`
}

// getSchulhofStatus handles GET /api/active/schulhof/status
func (rs *SchulhofResource) getSchulhofStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get current staff from user context
	staffID, found, err := rs.currentStaff(ctx)
	if err != nil || !found {
		common.RenderError(w, r, common.ErrorForbidden(errors.New("user must be a staff member")))
		return
	}

	// Get Schulhof status
	status, err := rs.schulhofService.Status(ctx, staffID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("failed to get Schulhof status", err))
		return
	}

	// Convert to API response
	resp := SchulhofStatusResponse{
		Exists:            status.Exists,
		RoomID:            status.RoomID,
		RoomName:          status.RoomName,
		ActivityGroupID:   status.ActivityGroupID,
		ActiveGroupID:     status.ActiveGroupID,
		IsUserSupervising: status.IsUserSupervising,
		SupervisionID:     status.SupervisionID,
		SupervisorCount:   status.SupervisorCount,
		StudentCount:      status.StudentCount,
		Supervisors:       make([]SupervisorInfoResponse, 0, len(status.Supervisors)),
	}

	for _, sup := range status.Supervisors {
		resp.Supervisors = append(resp.Supervisors, SupervisorInfoResponse{
			ID:            sup.ID,
			StaffID:       sup.StaffID,
			Name:          sup.Name,
			IsCurrentUser: sup.IsCurrentUser,
		})
	}

	common.Respond(w, r, http.StatusOK, resp, "")
}

func (rs *SchulhofResource) Register(r chi.Router, withTx common.Middleware) {
	r.Route("/schulhof", func(r chi.Router) {
		r.With(common.RequireActiveGroupRead(), withTx).Get("/status", rs.getSchulhofStatus)
	})
}

// SchulhofRouteContracts registers the typed contract of the courtyard status
// (ADR 0270), with patterns relative to /api/active.
func SchulhofRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/schulhof/status", Portals: []common.PortalScope{common.PortalTenant}, Response: SchulhofStatusResponse{}},
	}
}
