package devicescan

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SessionLifecycle serves the kiosk's manual session controls. It preserves
// best-effort heartbeat and roster reads; command failures remain errors.
type SessionLifecycle interface {
	StartSession(context.Context, StartSessionCommand) (SessionStartResponse, error)
	CurrentSession(context.Context) (SessionCurrentResponse, error)
	SessionToEnd(context.Context) (SessionToEnd, error)
	ReplaceSessionSupervisors(context.Context, int64, []int64) (UpdateSupervisorsResponse, error)
	TouchSession(context.Context) (int64, error)
}

// CodeRoomClosed refuses a session in a room the school closed for today
// (#7653). PyrePortal maps it to its own text.
const CodeRoomClosed = "iot.room_closed"

// RoomClosures answers whether the school closed a room on a day (#7653).
// Device Scan owns the port; the root binds it to Facilities' closures.
type RoomClosures interface {
	RoomClosedOn(ctx context.Context, roomID int64, day calendar.Date) (bool, error)
}

// StartSessionCommand carries the validated kiosk request.
type StartSessionCommand struct {
	ActivityID    int64
	RoomID        *int64
	SupervisorIDs []int64
	Force         bool
}

// SessionToEnd is the current session reference passed to Session End.
type SessionToEnd struct {
	ID         int64
	ActivityID *int64
	DeviceID   int64
	StartTime  time.Time
}

type SupervisorInfo struct {
	StaffID     int64  `json:"staff_id"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

type SessionStartResponse struct {
	ActiveGroupID int64                 `json:"active_group_id"`
	ActivityID    *int64                `json:"activity_id"`
	DeviceID      int64                 `json:"device_id"`
	StartTime     time.Time             `json:"start_time"`
	ConflictInfo  *ConflictInfoResponse `json:"conflict_info,omitempty"`
	Supervisors   []SupervisorInfo      `json:"supervisors,omitempty"`
	Status        string                `json:"status"`
	Message       string                `json:"message"`
}

type ConflictInfoResponse struct {
	HasConflict       bool   `json:"has_conflict"`
	ConflictingDevice *int64 `json:"conflicting_device,omitempty"`
	ConflictMessage   string `json:"conflict_message"`
	CanOverride       bool   `json:"can_override"`
}

type SessionCurrentResponse struct {
	ActiveGroupID  *int64     `json:"active_group_id,omitempty"`
	ActivityID     *int64     `json:"activity_id,omitempty"`
	ActivityName   *string    `json:"activity_name,omitempty"`
	RoomID         *int64     `json:"room_id,omitempty"`
	RoomName       *string    `json:"room_name,omitempty"`
	DeviceID       int64      `json:"device_id"`
	StartTime      *time.Time `json:"start_time,omitempty"`
	Duration       *string    `json:"duration,omitempty"`
	IsActive       bool       `json:"is_active"`
	ActiveStudents *int       `json:"active_students,omitempty"`
	// ActiveStudentsRevision orders ActiveStudents of the session
	// ActiveGroupID (#5128); present exactly when the count is.
	ActiveStudentsRevision *int64           `json:"active_students_revision,omitempty"`
	Supervisors            []SupervisorInfo `json:"supervisors,omitempty"`
}

type UpdateSupervisorsResponse struct {
	ActiveGroupID int64            `json:"active_group_id"`
	Supervisors   []SupervisorInfo `json:"supervisors"`
	Status        string           `json:"status"`
	Message       string           `json:"message"`
}
