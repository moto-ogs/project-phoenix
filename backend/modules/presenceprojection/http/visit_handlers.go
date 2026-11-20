package presenceprojectionhttp

import (
	errors "errors"
	http "net/http"

	common "github.com/moto-ogs/project-phoenix/api/common"
)

// getStudentCurrentVisit handles getting a student's current visit
func (rs *Resource) getStudentCurrentVisit(w http.ResponseWriter, r *http.Request) {
	// Parse ID from URL (we only need the ID, not the full student)
	studentID, err := common.ParseID(r)
	if err != nil {
		renderError(w, r, common.ErrorInvalidRequest(errors.New(common.MsgInvalidStudentID)))
		return
	}

	// Get current visit
	currentVisit, err := rs.ActiveService.GetStudentCurrentVisit(r.Context(), studentID)
	if err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	if currentVisit == nil {
		common.Respond(w, r, http.StatusOK, nil, "Student has no current visit")
		return
	}

	common.Respond(w, r, http.StatusOK, newStudentVisitResponse(*currentVisit), "Current visit retrieved successfully")
}
