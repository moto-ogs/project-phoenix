package api

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	feedbackAPI "github.com/moto-ogs/project-phoenix/modules/feedback/http"
	staffHTTP "github.com/moto-ogs/project-phoenix/modules/schoolmembership/http"
	reminderDelivery "github.com/moto-ogs/project-phoenix/workflows/reminderdelivery"
)

// The http roles of Feedback and Reminder Delivery may not import the
// contract types, so the root names their routes (#2352), with patterns
// relative to each mount.

// feedbackStudentRouteContracts registers the feedback of one child the
// student detail reads, relative to /api/feedback.
func feedbackStudentRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/student/{id}", Portals: tenantPortal, Response: []feedbackAPI.FeedbackResponse{}},
	}
}

// reminderRouteContracts registers the caller's reminders, relative to
// /api/reminders.
func reminderRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: tenantPortal, Response: reminderDelivery.Result{}},
	}
}

// staffDirectoryRouteContracts registers the School Membership reads of
// /api/staff that only forward. The role query answers null when no staff
// member holds the roles.
func staffDirectoryRouteContracts() []common.RouteContract {
	roles := []common.QueryParam{{Name: "role", Kind: common.QueryString}, {Name: "roles", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/documents-directory", Portals: tenantPortal, Response: []staffHTTP.DocumentDirectoryEntry{}},
		{Method: "GET", Pattern: "/by-role", Portals: tenantPortal, Query: roles, Response: &[]staffHTTP.StaffWithRoleResponse{}},
	}
}
