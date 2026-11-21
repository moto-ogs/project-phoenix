package parent

import (
	"context"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// stopRoomHistory stops the room history and mood of the guardian's child
// (#3844) and answers the child's consent list.
func (rs *Resource) stopRoomHistory(w http.ResponseWriter, r *http.Request) {
	rs.changeRoomHistoryStop(w, r, rs.ParentService.StopChildRoomHistory, "Room history stopped")
}

// resumeRoomHistory lifts the stop; moto records again from now on.
func (rs *Resource) resumeRoomHistory(w http.ResponseWriter, r *http.Request) {
	rs.changeRoomHistoryStop(w, r, rs.ParentService.ResumeChildRoomHistory, "Room history resumed")
}

func (rs *Resource) changeRoomHistoryStop(w http.ResponseWriter, r *http.Request, change func(context.Context, int64, int64) ([]parentService.ChildConsent, error), message string) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	studentID, ok := parsePathStudentID(w, r)
	if !ok {
		return
	}
	consents, err := change(r.Context(), accountID, studentID)
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toChildConsentResponses(consents), message)
}
