package presence

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
)

// Resource defines the active API resource
type Resource struct {
	Operations         PresenceOperations
	Presence           PresenceQueries
	PersonService      People
	UserContextService StaffAccess
	SettingsService    Settings
	displaySettings    DisplaySettings

	protectedRoutes func(chi.Router, func(chi.Router, common.Middleware))
	logger          *slog.Logger
	runtime         RequestRuntime
	authorization   Authorization
}

// getLogger returns the logger required by resource construction.
func (rs *Resource) getLogger() *slog.Logger {
	return rs.logger
}

// NewResource creates a new active resource
func NewResource(operations PresenceOperations, personService People, userContextService StaffAccess, settingsService Settings, protectedRoutes func(chi.Router, func(chi.Router, common.Middleware)), logger *slog.Logger, presence PresenceQueries, runtime RequestRuntime, authorization Authorization, displaySettings DisplaySettings) *Resource {
	if logger == nil {
		panic("active API: logger is required")
	}
	if protectedRoutes == nil {
		panic("active API: protected tenant routes are required")
	}
	if presence == nil {
		panic("active API: student presence queries are required")
	}
	if runtime.WithStaff == nil {
		panic("active API: staff attribution is required")
	}
	if runtime.TenantID == nil || runtime.MarkRollback == nil || runtime.Now == nil {
		panic("active API: tenant request runtime is required")
	}
	if authorization.OperationalOverview == nil {
		panic("active API: overview authorization is required")
	}
	if displaySettings == nil {
		panic("active API: display settings facts are required")
	}
	return &Resource{
		Operations:         operations,
		Presence:           presence,
		PersonService:      personService,
		UserContextService: userContextService,
		SettingsService:    settingsService,
		displaySettings:    displaySettings,
		protectedRoutes:    protectedRoutes,
		logger:             logger,
		runtime:            runtime,
		authorization:      authorization,
	}
}

// Router returns a configured router for active endpoints
func (rs *Resource) Router(mounts ...func(chi.Router, common.Middleware)) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))

	// Protected routes that require authentication and permissions
	rs.protectedRoutes(r, func(r chi.Router, withTx common.Middleware) {

		for _, mount := range mounts {
			mount(r, withTx)
		}

		rs.registerActiveGroupRoutes(r, withTx)
		rs.registerVisitRoutes(r, withTx)
		rs.registerSupervisorRoutes(r, withTx)
		rs.registerAnalyticsRoutes(r, withTx)

	})

	return r
}

func (rs *Resource) registerActiveGroupRoutes(r chi.Router, withTx common.Middleware) {
	// Active Groups
	r.Route("/groups", func(r chi.Router) {
		// Read operations
		r.With(common.RequireActiveGroupRead(), withTx).Get("/", rs.listActiveGroups)
		r.With(common.RequireActiveGroupRead(), withTx).Get("/{id}/supervisors", rs.getActiveGroupSupervisors)

		// Write operations
		r.With(common.RequireActiveGroupUpdate(), withTx).Post("/{id}/claim", rs.claimGroup)
	})

}

func (rs *Resource) registerVisitRoutes(r chi.Router, withTx common.Middleware) {
	// Visits
	r.Route("/visits", func(r chi.Router) {
		// Read operations
		r.With(common.RequireActiveGroupRead(), withTx).Get("/", rs.listVisits)

		// Write operations

		// Bulk assign checked-in students without a room visit to an active room session.
		r.With(common.RequireVisitUpdate(), withTx, common.RequireWebAttendanceEnabled(rs.displaySettings.WebAttendanceEnabledReader())).Post("/transit/assign", rs.assignTransitStudents)
		r.With(common.RequireVisitUpdate(), withTx, common.RequireWebAttendanceEnabled(rs.displaySettings.WebAttendanceEnabledReader())).Post("/move-to-group", rs.moveStudentsToActiveGroup)
		// Check children in and place them in a running session in one step
		// (#6953): needs the check-in and the move right.
		r.With(common.RequireSchoolCheckin(), common.RequireVisitUpdate(), withTx, common.RequireWebAttendanceEnabled(rs.displaySettings.WebAttendanceEnabledReader())).Post("/check-in-to-group", rs.checkInStudentsToSession)
	})

}

func (rs *Resource) registerSupervisorRoutes(r chi.Router, withTx common.Middleware) {
	// Supervisors
	r.Route("/supervisors", func(r chi.Router) {
		// Read operations
		r.With(common.RequireActiveGroupRead(), withTx).Get("/staff/{staffId}/active", rs.getStaffActiveSupervisions)
		r.With(common.RequireActiveGroupRead(), withTx).Get("/all", rs.getAllActiveSupervisions)

		// Write operations
		r.With(common.RequireActiveGroupUpdate(), withTx).Post(routeEndByID, rs.endSupervision)
	})

}

func (rs *Resource) registerAnalyticsRoutes(r chi.Router, withTx common.Middleware) {
	// Analytics
	r.Route("/analytics", func(r chi.Router) {
		r.With(common.RequireActiveGroupRead(), withTx).Get("/dashboard", rs.getDashboardAnalytics)
	})

	// Tracking indicators (bulk check if students visited configured rooms/activities today)
	r.With(common.RequireActiveGroupRead(), withTx).Post("/tracking-indicators", rs.getTrackingIndicators)

	// Cross-tenant students (Ferienbetreuung / holiday care)

}
