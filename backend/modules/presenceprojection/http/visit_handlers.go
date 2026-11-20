package presenceprojectionhttp

import (
	errors "errors"
	slog "log/slog"
	http "net/http"
	time "time"

	common "github.com/moto-ogs/project-phoenix/api/common"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// getStudentVisitHistory handles getting a student's visit history for today.
//
// Deprecated: Use GET /students/{id}/attendance-history instead, which supports
// arbitrary date ranges and includes the daily attendance log. This endpoint
// will be removed in a future release.
func (rs *Resource) getStudentVisitHistory(w http.ResponseWriter, r *http.Request) {
	// Parse student ID from URL
	studentID, err := common.ParseID(r)
	if err != nil {
		renderError(w, r, common.ErrorInvalidRequest(errors.New(common.MsgInvalidStudentID)))
		return
	}

	// Signal deprecation to clients per RFC 8594.
	w.Header().Set("Deprecation", "true")
	w.Header().Set("Link", `</api/students/{id}/attendance-history>; rel="successor-version"`)
	rs.Logger.Warn("deprecated endpoint called",
		slog.String("endpoint", "GET /students/{id}/visit-history"),
		slog.String("successor", "GET /students/{id}/attendance-history"),
		slog.Int64("student_id", studentID),
	)

	// Get all visits for this student
	visits, err := rs.ActiveService.FindVisitsByStudentID(r.Context(), studentID)
	if err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	// Filter to today's visits only
	today := calendar.DateOf(rs.Now())
	tomorrow := today.Add(24 * time.Hour)

	var todaysVisits []studentVisitResponse
	for _, visit := range visits {
		if visit.EntryTime.After(today) && visit.EntryTime.Before(tomorrow) {
			todaysVisits = append(todaysVisits, newStudentVisitResponse(visit))
		}
	}

	common.Respond(w, r, http.StatusOK, todaysVisits, "Visit history retrieved successfully")
}
