package parent

import (
	"context"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// ChildRoomHistoryStopResponse tells a guardian whether the room history and
// mood of the child are stopped (#3844). Offered is false while the Träger
// has not let parents stop it and the child is not stopped; CanChange needs
// the Träger's switch and the consent permission.
type ChildRoomHistoryStopResponse struct {
	Offered   bool       `json:"offered"`
	Stopped   bool       `json:"stopped"`
	StoppedAt *time.Time `json:"stopped_at,omitempty"`
	CanChange bool       `json:"can_change"`
}

// getRoomHistoryStop reads the stop of the guardian's child.
func (rs *Resource) getRoomHistoryStop(w http.ResponseWriter, r *http.Request) {
	rs.answerRoomHistoryStop(w, r, rs.ParentService.GetChildRoomHistoryStop, "Room history stop retrieved")
}

// stopRoomHistory stops the room history and mood of the guardian's child.
func (rs *Resource) stopRoomHistory(w http.ResponseWriter, r *http.Request) {
	rs.answerRoomHistoryStop(w, r, rs.ParentService.StopChildRoomHistory, "Room history stopped")
}

// resumeRoomHistory lifts the stop; moto records again from now on.
func (rs *Resource) resumeRoomHistory(w http.ResponseWriter, r *http.Request) {
	rs.answerRoomHistoryStop(w, r, rs.ParentService.ResumeChildRoomHistory, "Room history resumed")
}

func (rs *Resource) answerRoomHistoryStop(w http.ResponseWriter, r *http.Request, call func(context.Context, int64, int64) (parentService.ChildRoomHistoryStop, error), message string) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	studentID, ok := parsePathStudentID(w, r)
	if !ok {
		return
	}
	view, err := call(r.Context(), accountID, studentID)
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, ChildRoomHistoryStopResponse{
		Offered: view.Offered, Stopped: view.Stopped, StoppedAt: view.StoppedAt, CanChange: view.CanChange,
	}, message)
}
