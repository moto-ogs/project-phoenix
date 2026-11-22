package httpadapter

import (
	"errors"
	"net/http"
	"strings"
	"time"

	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

const (
	msgActivityCreatedSuccess = "Activity created successfully"
	msgActivityUpdatedSuccess = "Activity updated successfully"
)

// ActivityCategoryResponse represents a category API response
type ActivityCategoryResponse struct {
	ID          ident.ID `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Color       string   `json:"color,omitempty"`
	// ShiftTypeID is the optional Dienstplan-Schichtart this category maps to
	// (#1836/#1837 follow-up); nil = no mapping. Consumers resolve the shift
	// type's name/color from the shift-types list.
	ShiftTypeID *ident.ID `json:"shift_type_id,omitempty"`
	// IsSystem marks auto-provisioned infrastructure categories (Schulhof,
	// WC). They are read-only for schools (#2131).
	IsSystem bool `json:"is_system"`
	// ArchivedAt is set once a category has been retired. Archived categories
	// stay resolvable for existing Termine but are not offered for new ones.
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
	// UsageCount is how many Aktivitäten/Termin-Vorlagen reference the
	// category. Only populated by the category list endpoint; nil elsewhere.
	UsageCount *int      `json:"usage_count,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// ActivitySupervisorResponse represents a supervisor in activity response
type ActivitySupervisorResponse struct {
	ID        ident.ID `json:"id"`
	StaffID   ident.ID `json:"staff_id"`
	IsPrimary bool     `json:"is_primary"`
	FirstName string   `json:"first_name,omitempty"`
	LastName  string   `json:"last_name,omitempty"`
}

// ActivityResponse represents an activity group API response
type ActivityResponse struct {
	ID              ident.ID                     `json:"id"`
	Name            string                       `json:"name"`
	MaxParticipants *int                         `json:"max_participants"`
	IsOpen          bool                         `json:"is_open"`
	CategoryID      ident.ID                     `json:"category_id"`
	PlannedRoomID   *ident.ID                    `json:"planned_room_id,omitempty"`
	CreatedBy       *ident.ID                    `json:"created_by"`
	CreatedByName   string                       `json:"created_by_name,omitempty"`
	Category        *ActivityCategoryResponse    `json:"category,omitempty"`
	SupervisorID    *ident.ID                    `json:"supervisor_id,omitempty"`  // Primary supervisor
	SupervisorIDs   []ident.ID                   `json:"supervisor_ids,omitempty"` // All supervisors
	Supervisors     []ActivitySupervisorResponse `json:"supervisors,omitempty"`    // Detailed supervisor info
	Schedules       []ActivityScheduleResponse   `json:"schedules,omitempty"`
	EnrollmentCount int                          `json:"enrollment_count,omitempty"`
	CreatedAt       time.Time                    `json:"created_at"`
	UpdatedAt       time.Time                    `json:"updated_at"`
}

// ActivityScheduleResponse represents a schedule API response
type ActivityScheduleResponse struct {
	ID              ident.ID  `json:"id"`
	Weekday         int       `json:"weekday"`
	TimeframeID     *ident.ID `json:"timeframe_id,omitempty"`
	ActivityGroupID ident.ID  `json:"activity_group_id"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// EnrolledStudentResponse is one student enrolled in an activity.
type EnrolledStudentResponse struct {
	ID        ident.ID `json:"id"`
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
}

// EnrollmentUpdateResponse answers a replaced enrollment list.
type EnrollmentUpdateResponse struct {
	ActivityID       ident.ID   `json:"activity_id"`
	ActivityName     string     `json:"activity_name"`
	EnrollmentCount  int        `json:"enrollment_count"`
	MaxParticipants  *int       `json:"max_participants"`
	StudentsEnrolled []ident.ID `json:"students_enrolled"`
}

// ActivityRequest represents an activity creation/update request
type ActivityRequest struct {
	Name            string            `json:"name"`
	MaxParticipants *int              `json:"max_participants"`
	IsOpen          bool              `json:"is_open"`
	CategoryID      ident.ID          `json:"category_id"`
	PlannedRoomID   *ident.ID         `json:"planned_room_id,omitempty"`
	Schedules       []ScheduleRequest `json:"schedules,omitempty"`
	SupervisorIDs   []ident.ID        `json:"supervisor_ids,omitempty"`
}

// QuickActivityRequest represents a simplified activity creation request for mobile devices
type QuickActivityRequest struct {
	Name            string    `json:"name"`
	CategoryID      ident.ID  `json:"category_id"`
	RoomID          *ident.ID `json:"room_id,omitempty"`
	MaxParticipants *int      `json:"max_participants"`
}

// QuickActivityResponse represents the response after creating an activity via quick-create
type QuickActivityResponse struct {
	ActivityID     ident.ID  `json:"activity_id"`
	Name           string    `json:"name"`
	CategoryName   string    `json:"category_name"`
	RoomName       string    `json:"room_name,omitempty"`
	SupervisorName string    `json:"supervisor_name"`
	Status         string    `json:"status"`
	Message        string    `json:"message"`
	CreatedAt      time.Time `json:"created_at"`
}

// ScheduleRequest represents a schedule in activity creation/update request
type ScheduleRequest struct {
	Weekday     int       `json:"weekday"`
	TimeframeID *ident.ID `json:"timeframe_id,omitempty"`
}

// Bind validates the activity request
func (req *ActivityRequest) Bind(_ *http.Request) error {
	if req.Name == "" {
		return errors.New("activity name is required")
	}
	if req.MaxParticipants != nil && *req.MaxParticipants < 0 {
		return errors.New("max participants cannot be negative")
	}
	if req.CategoryID <= 0 {
		return errors.New("category ID is required")
	}

	// Validate schedules if provided
	if len(req.Schedules) > 0 {
		for _, schedule := range req.Schedules {
			if !activityContract.IsValidWeekday(schedule.Weekday) {
				return errors.New("invalid weekday in schedule")
			}
		}
	}

	return nil
}

// Bind validates the quick activity request
func (req *QuickActivityRequest) Bind(_ *http.Request) error {
	if req.CategoryID <= 0 {
		return errors.New("category ID is required")
	}
	return validateNewActivity(req.Name, req.MaxParticipants)
}

// validateNewActivity holds the rules a new activity meets beyond the shared
// request checks: a name that is more than blanks, and a participant limit
// that is either absent (no limit) or at least one. Updates keep accepting
// 0 as "no limit"; only the create routes refused it (#7563).
func validateNewActivity(name string, maxParticipants *int) error {
	if strings.TrimSpace(name) == "" {
		return errors.New("activity name is required")
	}
	if maxParticipants != nil && *maxParticipants <= 0 {
		return errors.New("max participants must be greater than 0")
	}
	return nil
}

// participantLimit is the stored form of a requested limit: 0 for none.
func participantLimit(maxParticipants *int) int {
	if maxParticipants == nil {
		return 0
	}
	return *maxParticipants
}

// BatchEnrollmentRequest represents a request for updating enrollments in batch.
// Each student ID reads a JSON number or a decimal string.
type BatchEnrollmentRequest struct {
	StudentIDs []ident.ID `json:"student_ids"`
}

// studentIDs returns the requested student IDs as int64s.
func (req *BatchEnrollmentRequest) studentIDs() []int64 {
	ids := make([]int64, len(req.StudentIDs))
	for i, id := range req.StudentIDs {
		ids[i] = id.Int64()
	}
	return ids
}

// Bind validates the batch enrollment request
func (req *BatchEnrollmentRequest) Bind(_ *http.Request) error {
	if req.StudentIDs == nil {
		return errors.New("student IDs are required")
	}
	return nil
}
