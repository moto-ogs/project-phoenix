package sessions

import (
	"errors"
	"net/http"
	"time"

	validation "github.com/go-ozzo/ozzo-validation"
	"github.com/moto-ogs/project-phoenix/modules/devicescan"
)

// The identifiers of the kiosk device API stay JSON numbers and say so with
// contract:"number": PyrePortal v1.11.5 reads them as numbers (#7808).

// SessionStartRequest represents a request to start an activity session
type SessionStartRequest struct {
	ActivityID    int64   `json:"activity_id" contract:"number"`
	RoomID        *int64  `json:"room_id,omitempty" contract:"number"`        // Optional: Override the activity's planned room
	SupervisorIDs []int64 `json:"supervisor_ids,omitempty" contract:"number"` // Multiple supervisors support
	Force         bool    `json:"force,omitempty"`
}

// Bind implements render.Binder interface for SessionStartRequest
func (req *SessionStartRequest) Bind(_ *http.Request) error {
	// Validate request
	if req.ActivityID <= 0 {
		return errors.New("activity_id is required")
	}

	return nil
}

// SupervisorInfo represents information about a supervisor
type SupervisorInfo = devicescan.SupervisorInfo

// SessionStartResponse represents the response when starting an activity session.
// ActivityID is nullable (WP-B6): an API client that triggers a spontaneous
// session still receives a response, but with `activity_id: null`. The
// existing IoT start flow always carries a template id, so `null` never
// appears for today's NFC path.
type SessionStartResponse = devicescan.SessionStartResponse

// ConflictInfoResponse represents conflict information for API responses
type ConflictInfoResponse = devicescan.ConflictInfoResponse

// SessionActivityRequest represents a session activity update request
type SessionActivityRequest struct {
	ActivityType string    `json:"activity_type"` // "rfid_scan", "button_press", "ui_interaction"
	Timestamp    time.Time `json:"timestamp"`
}

// Bind validates the session activity request
func (req *SessionActivityRequest) Bind(_ *http.Request) error {
	if err := validation.ValidateStruct(req,
		validation.Field(&req.ActivityType, validation.Required, validation.In("rfid_scan", "button_press", "ui_interaction")),
	); err != nil {
		return err
	}

	return nil
}

// SessionCurrentResponse represents the current session information
type SessionCurrentResponse = devicescan.SessionCurrentResponse

// UpdateSupervisorsRequest represents a request to update supervisors for an active session
type UpdateSupervisorsRequest struct {
	SupervisorIDs []int64 `json:"supervisor_ids" contract:"number"`
}

// Bind validates the update supervisors request
func (req *UpdateSupervisorsRequest) Bind(_ *http.Request) error {
	if len(req.SupervisorIDs) == 0 {
		return errors.New("at least one supervisor is required")
	}
	return nil
}

// UpdateSupervisorsResponse represents the response when updating supervisors
type UpdateSupervisorsResponse = devicescan.UpdateSupervisorsResponse
