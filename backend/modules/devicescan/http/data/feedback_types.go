package data

import (
	"errors"
	"net/http"
)

// The identifiers of the kiosk device API stay JSON numbers and say so with
// contract:"number": PyrePortal v1.11.5 reads them as numbers (#7808).

// IoTFeedbackRequest represents a feedback submission from an IoT device
type IoTFeedbackRequest struct {
	StudentID int64  `json:"student_id" contract:"number"`
	Value     string `json:"value"` // "positive", "neutral", or "negative"
}

// Bind validates the feedback request
func (req *IoTFeedbackRequest) Bind(_ *http.Request) error {
	if req.StudentID <= 0 {
		return errors.New("student_id is required and must be positive")
	}
	if req.Value == "" {
		return errors.New("value is required")
	}
	// Value validation is handled by the Feedback facade.
	return nil
}
