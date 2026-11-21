package studentpresencehttp

import (
	"errors"
	http "net/http"
	time "time"

	common "github.com/moto-ogs/project-phoenix/api/common"
	sessiontoken "github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	peopleModule "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	studentpresence "github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// errRoomHistoryStopsUnavailable is the bare-Resource outcome: without the
// owner capability the routes refuse.
var errRoomHistoryStopsUnavailable = errors.New("room history stop capability is not configured")

// RoomHistoryStopResponse tells whether the room history and the mood
// capture of a child are stopped (#3844). DeletedVisits counts the completed
// visits a new stop deleted; it is zero on every other answer.
type RoomHistoryStopResponse struct {
	StudentID     common.ID  `json:"student_id"`
	Stopped       bool       `json:"stopped"`
	StoppedAt     *time.Time `json:"stopped_at,omitempty"`
	DeletedVisits int        `json:"deleted_visits"`
}

// getRoomHistoryStop answers whether the child's room history is stopped.
func (rs *Resource) getRoomHistoryStop(w http.ResponseWriter, r *http.Request) {
	student, ok := rs.roomHistoryStopTarget(w, r, rs.checkStudentReadAccess)
	if !ok {
		return
	}
	stops, err := rs.RoomHistoryStops.RoomHistoryStoppedSince(r.Context(), []int64{student})
	if err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}
	response := RoomHistoryStopResponse{StudentID: common.ID(student)}
	if since, found := stops[student]; found {
		response.Stopped, response.StoppedAt = true, &since
	}
	common.Respond(w, r, http.StatusOK, response, "Room history stop retrieved successfully")
}

// stopRoomHistory stops the child's room history and mood capture and
// deletes its completed visits. Stopping a stopped child changes nothing.
func (rs *Resource) stopRoomHistory(w http.ResponseWriter, r *http.Request) {
	student, ok := rs.roomHistoryStopTarget(w, r, rs.checkStudentFullAccess)
	if !ok {
		return
	}
	result, err := rs.RoomHistoryStops.StopRoomHistory(r.Context(), roomHistoryStopChange(r, student))
	if err != nil {
		renderRoomHistoryStopError(w, r, err)
		return
	}
	stoppedAt := result.StoppedAt
	common.Respond(w, r, http.StatusOK, RoomHistoryStopResponse{
		StudentID: common.ID(student), Stopped: true, StoppedAt: &stoppedAt, DeletedVisits: int(result.DeletedVisits),
	}, "Room history stopped successfully")
}

// resumeRoomHistory lifts the stop; recording starts again from now on.
func (rs *Resource) resumeRoomHistory(w http.ResponseWriter, r *http.Request) {
	student, ok := rs.roomHistoryStopTarget(w, r, rs.checkStudentFullAccess)
	if !ok {
		return
	}
	if _, err := rs.RoomHistoryStops.ResumeRoomHistory(r.Context(), roomHistoryStopChange(r, student)); err != nil {
		renderRoomHistoryStopError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, RoomHistoryStopResponse{StudentID: common.ID(student)}, "Room history resumed successfully")
}

// roomHistoryStopTarget resolves the child and checks the caller's access to
// it with the given gate.
func (rs *Resource) roomHistoryStopTarget(w http.ResponseWriter, r *http.Request, allowed func(*http.Request, *peopleModule.StudentState) bool) (int64, bool) {
	if rs.RoomHistoryStops == nil {
		renderError(w, r, common.ErrorInternalServer(errRoomHistoryStopsUnavailable))
		return 0, false
	}
	student, ok := rs.parseAndGetStudent(w, r)
	if !ok {
		return 0, false
	}
	if !allowed(r, student) {
		renderError(w, r, common.ErrorForbidden(errors.New("insufficient permissions to access this student's data")))
		return 0, false
	}
	return student.ID, true
}

// roomHistoryStopChange names the staff member for the change history; a
// token without a name falls back to the account's login.
func roomHistoryStopChange(r *http.Request, studentID int64) studentpresence.RoomHistoryStopChange {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	name := claims.DisplayName()
	if name == "" {
		name = claims.Sub
	}
	return studentpresence.RoomHistoryStopChange{StudentID: studentID, Actor: studentpresence.RoomHistoryStopActor{
		AccountID: int64(claims.ID), Name: name, Source: studentpresence.RoomHistoryStopSourceTenantPortal,
	}}
}

func renderRoomHistoryStopError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, studentpresence.ErrInvalidRoomHistoryStop) {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	renderError(w, r, common.ErrorInternalServer(err))
}
