package sessions

import (
	"net/http"

	"github.com/go-chi/render"
)

// updateSessionActivity handles activity updates for timeout tracking
func (rs *Resource) updateSessionActivity(w http.ResponseWriter, r *http.Request) {
	if !rs.requireDevice(w, r) {
		return
	}

	var req SessionActivityRequest
	if err := render.Bind(r, &req); err != nil {
		rs.renderError(w, r, err)
		return
	}
	// A request without a timestamp happened now.
	if req.Timestamp.IsZero() {
		req.Timestamp = rs.runtime.Now()
	}

	sessionID, err := rs.Lifecycle.TouchSession(r.Context())
	if err != nil {
		rs.renderError(w, r, err)
		return
	}

	now := rs.runtime.Now()
	response := map[string]interface{}{
		"session_id":    sessionID,
		"activity_type": req.ActivityType,
		"updated_at":    now,
		"last_activity": now,
	}

	rs.runtime.Success(w, r, http.StatusOK, response, "Session activity updated")
}
