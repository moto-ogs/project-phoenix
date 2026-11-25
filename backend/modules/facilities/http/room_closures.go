package httpadapter

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// RoomClosureRequest closes a room from start_date through end_date, both
// included, for its reason (#7653).
type RoomClosureRequest struct {
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	Reason    string        `json:"reason"`
}

// Bind leaves every rule of a closure to the owner.
func (*RoomClosureRequest) Bind(*http.Request) error { return nil }

// RoomClosureResponse is one closure of a room. Every staff account that
// may read the rooms sees it with its reason: the reason names the room's
// state, never a person.
type RoomClosureResponse struct {
	ID        ident.ID      `json:"id"`
	RoomID    ident.ID      `json:"room_id"`
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	Reason    string        `json:"reason"`
	CreatedAt time.Time     `json:"created_at"`
}

func newRoomClosureResponse(closure facilities.RoomClosure) RoomClosureResponse {
	return RoomClosureResponse{
		ID: ident.ID(closure.ID), RoomID: ident.ID(closure.RoomID), StartDate: closure.StartDate,
		EndDate: closure.EndDate, Reason: closure.Reason, CreatedAt: closure.CreatedAt,
	}
}

// listRoomClosures answers the closures overlapping from through to; the
// room pickers ask it for the day of an appointment, the room page for a
// room from today on.
func (rs *Resource) listRoomClosures(w http.ResponseWriter, r *http.Request) {
	filter, err := roomClosureFilter(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err, "invalid_request")
		return
	}
	closures, err := rs.closures.ListRoomClosures(r.Context(), filter)
	if err != nil {
		rs.failure(w, r, err)
		return
	}
	responses := make([]RoomClosureResponse, 0, len(closures))
	for _, closure := range closures {
		responses = append(responses, newRoomClosureResponse(closure))
	}
	rs.runtime.Success(w, r, http.StatusOK, responses, "Room closures retrieved")
}

func roomClosureFilter(r *http.Request) (facilities.RoomClosureFilter, error) {
	from, err := calendar.ParseDate(r.URL.Query().Get("from"))
	if err != nil {
		return facilities.RoomClosureFilter{}, errors.New("from must be a date (YYYY-MM-DD)")
	}
	until, err := calendar.ParseDate(r.URL.Query().Get("to"))
	if err != nil {
		return facilities.RoomClosureFilter{}, errors.New("to must be a date (YYYY-MM-DD)")
	}
	filter := facilities.RoomClosureFilter{From: from, Until: until}
	if value := r.URL.Query().Get("room_id"); value != "" {
		roomID, err := strconv.ParseInt(value, 10, 64)
		if err != nil || roomID <= 0 {
			return facilities.RoomClosureFilter{}, errors.New("invalid room_id")
		}
		filter.RoomID = &roomID
	}
	return filter, nil
}

func (rs *Resource) closeRoom(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, errors.New("invalid room ID"), "invalid_request")
		return
	}
	req := &RoomClosureRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err, "invalid_request")
		return
	}
	closure, err := rs.closures.CloseRoom(r.Context(), facilities.CloseRoom{
		RoomID: id, StartDate: req.StartDate, EndDate: req.EndDate, Reason: req.Reason,
	})
	if err != nil {
		rs.failure(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusCreated, newRoomClosureResponse(closure), "Room closed")
}

func (rs *Resource) reopenRoom(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, errors.New("invalid room ID"), "invalid_request")
		return
	}
	closureID, err := strconv.ParseInt(chi.URLParam(r, "closureId"), 10, 64)
	if err != nil || closureID <= 0 {
		rs.runtime.Failure(w, r, FailureInvalid, errors.New("invalid closure ID"), "invalid_request")
		return
	}
	if err := rs.closures.ReopenRoom(r.Context(), id, closureID); err != nil {
		rs.failure(w, r, err)
		return
	}
	rs.runtime.NoContent(w, r)
}
