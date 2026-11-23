package announcement

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	announcementService "github.com/moto-ogs/project-phoenix/modules/communication"
)

// reminderRequest is the post-publish reminder edit. Presence distinguishes
// the distinction between an omitted reminder_at (invalid PUT body) and an
// explicit null (remove the reminder).
type reminderRequest struct {
	ReminderAt   common.DeferredJSON[*time.Time] `json:"reminder_at" contract_refines:"The reminder handler already requires an RFC 3339 instant or null"`
	ReminderText *string                         `json:"reminder_text,omitempty"`
	// ExpectedVersion is the version of the announcement whose reminder
	// was read (ADR 0311).
	ExpectedVersion string `json:"expected_version"`
}

// updateReminder moves, rewords or removes the scheduled reminder of an
// announcement — the one edit that stays open after publishing, until the
// reminder has been sent.
func (rs *Resource) updateReminder(w http.ResponseWriter, r *http.Request) {
	id, ok := parseAnnouncementID(w, r)
	if !ok {
		return
	}
	var req reminderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}
	if !req.ReminderAt.Present {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("reminder_at is required")))
		return
	}
	if req.ReminderAt.Invalid != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid reminder_at")))
		return
	}
	a, err := rs.Service.UpdateParentAnnouncementReminder(r.Context(), id, announcementService.ParentAnnouncementReminderInput{
		ReminderAt: req.ReminderAt.Value, ReminderText: req.ReminderText, ExpectedVersion: req.ExpectedVersion,
	})
	if err != nil {
		renderAnnouncementError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toAnnouncementResponse(a, rs.now()), "Announcement reminder updated")
}
