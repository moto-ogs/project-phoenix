package presence

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Route path constants
const (
	routeGroupByGroupID = "/group/{groupId}"
	routeEndByID        = "/{id}/end"
)

// Validation error messages
const (
	errMsgStartTimeRequired      = "start time is required"
	errMsgActiveGroupIDRequired  = "active group ID is required"
	errMsgInvalidActiveGroupID   = "invalid active group ID"
	errMsgInvalidGroupID         = "invalid group ID"
	errMsgInvalidVisitID         = "invalid visit ID"
	errMsgInvalidStudentID       = "invalid student ID"
	errMsgInvalidSupervisorID    = "invalid supervisor ID"
	errMsgInvalidCombinedGroupID = "invalid combined group ID"
)

// Response messages
const ()

// ===== Response Types =====

// ActiveGroupResponse represents an active group API response.
// GroupID is nullable (WP-B6): spontaneous sessions — started ad-hoc without
// a parent template in activities.groups — serialize as `null`. The tag
// intentionally omits `omitempty` so clients always see the field and are
// forced to handle the null case explicitly.
type ActiveGroupResponse struct {
	ID              ident.ID                `json:"id"`
	GroupID         *ident.ID               `json:"group_id"`
	RoomID          ident.ID                `json:"room_id"`
	StartTime       time.Time               `json:"start_time"`
	EndTime         *time.Time              `json:"end_time,omitempty"`
	IsActive        bool                    `json:"is_active"`
	VisitCount      int                     `json:"visit_count,omitempty"`
	SupervisorCount int                     `json:"supervisor_count,omitempty"`
	Supervisors     []GroupSupervisorSimple `json:"supervisors,omitempty"`
	Room            *RoomSimple             `json:"room,omitempty"`
	CreatedAt       time.Time               `json:"created_at"`
	UpdatedAt       time.Time               `json:"updated_at"`
}

// GroupSupervisorSimple represents simplified supervisor info for active group response
type GroupSupervisorSimple struct {
	StaffID ident.ID `json:"staff_id"`
	Role    string   `json:"role,omitempty"`
}

// RoomSimple represents simplified room info for active group response.
//
// Color is included so badge consumers (active-supervisions BFF, OGS dashboard
// BFF) can paint per-room badges without a follow-up GET /rooms/{id} per
// active group. omitempty keeps responses unchanged for rooms with no color
// override; clients fall back to the OTHER_ROOM blue.
type RoomSimple struct {
	ID    ident.ID `json:"id"`
	Name  string   `json:"name"`
	Color *string  `json:"color,omitempty"`
}

// VisitResponse represents a visit API response
type VisitResponse struct {
	ID              ident.ID   `json:"id"`
	StudentID       ident.ID   `json:"student_id"`
	ActiveGroupID   ident.ID   `json:"active_group_id"`
	CheckInTime     time.Time  `json:"check_in_time"`
	CheckOutTime    *time.Time `json:"check_out_time,omitempty"`
	IsActive        bool       `json:"is_active"`
	StudentName     string     `json:"student_name,omitempty"`
	ActiveGroupName string     `json:"active_group_name,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// SupervisorResponse represents a group supervisor API response
type SupervisorResponse struct {
	ID              ident.ID   `json:"id"`
	StaffID         ident.ID   `json:"staff_id"`
	ActiveGroupID   ident.ID   `json:"active_group_id"`
	StartTime       time.Time  `json:"start_time"`
	EndTime         *time.Time `json:"end_time,omitempty"`
	IsActive        bool       `json:"is_active"`
	StaffName       string     `json:"staff_name,omitempty"`
	ActiveGroupName string     `json:"active_group_name,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// DashboardAnalyticsResponse represents dashboard analytics API response
type DashboardAnalyticsResponse struct {
	// Student Overview
	StudentsPresent      int `json:"students_present"`
	StudentsInTransit    int `json:"students_in_transit"` // Students present but not in any active visit
	StudentsOnPlayground int `json:"students_on_playground"`
	StudentsInRooms      int `json:"students_in_rooms"`  // Students in indoor rooms (excluding playground)
	StudentsSick         int `json:"students_sick"`      // Students currently flagged as sick
	StudentsExcused      int `json:"students_excused"`   // Students currently flagged as excused
	StudentsHome         int `json:"students_home"`      // Active students neither present nor sick/excused, nor at school or in class
	StudentsAtSchool     int `json:"students_at_school"` // Expected students before their first check-in (#3260)
	StudentsInClass      int `json:"students_in_class"`  // Students checked out to class who have not come back (#5656)

	// Activities & Rooms
	ActiveActivities    int     `json:"active_activities"`
	FreeRooms           int     `json:"free_rooms"`
	TotalRooms          int     `json:"total_rooms"`
	CapacityUtilization float64 `json:"capacity_utilization"`
	ActivityCategories  int     `json:"activity_categories"`

	// OGS Groups
	ActiveOGSGroups      int `json:"active_ogs_groups"`
	StudentsInGroupRooms int `json:"students_in_group_rooms"`
	SupervisorsToday     int `json:"supervisors_today"`
	StudentsInHomeRoom   int `json:"students_in_home_room"`

	// Recent Activity (Privacy-compliant)
	RecentActivity []RecentActivityItem `json:"recent_activity"`

	// Current Activities (No personal data)
	CurrentActivities []CurrentActivityItem `json:"current_activities"`

	// Active Groups Summary
	ActiveGroupsSummary []ActiveGroupSummary `json:"active_groups_summary"`

	// Timestamp
	LastUpdated time.Time `json:"last_updated"`
}

// RecentActivityItem represents a recent activity without personal data
type RecentActivityItem struct {
	Type      string    `json:"type"`
	GroupName string    `json:"group_name"`
	RoomName  string    `json:"room_name"`
	Count     int       `json:"count"`
	Timestamp time.Time `json:"timestamp"`
}

// CurrentActivityItem represents current activity status
type CurrentActivityItem struct {
	ID           ident.ID `json:"id"`
	Name         string   `json:"name"`
	Category     string   `json:"category"`
	Participants int      `json:"participants"`
	MaxCapacity  *int     `json:"max_capacity"`
	Status       string   `json:"status"`
}

// ActiveGroupSummary represents active group summary
type ActiveGroupSummary struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	StudentCount int    `json:"student_count"`
	// MaxCapacity is the activity's limit; absent without one (#3634).
	MaxCapacity *int   `json:"max_capacity,omitempty"`
	Location    string `json:"location"`
	Status      string `json:"status"`
}

// TrackingIndicatorsResponse returns labels and per-student match results
type TrackingIndicatorsResponse struct {
	Labels  []string         `json:"labels"`
	Results map[int64][]bool `json:"results"`
}

// TrackingIndicatorsRequest is the request body for POST /tracking-indicators
type TrackingIndicatorsRequest struct {
	StudentIDs []ident.ID `json:"student_ids"`
}
