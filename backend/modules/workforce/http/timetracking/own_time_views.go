package timetracking

import (
	"context"
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func (rs *Resource) getOwnPeriod(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	view := query.Get("view")
	start, err := calendar.ParseDate(query.Get("start"))
	if err != nil || len(query["start"]) != 1 || len(query["view"]) != 1 {
		common.RenderError(w, r, common.ErrorInvalidRequest(workforce.ErrInvalidOwnTimePeriod))
		return
	}
	respondOwnView(rs, w, r, func(ctx context.Context, staffID int64) (workforce.OwnTimePeriod, error) {
		return rs.ownViews.Period(ctx, staffID, view, start)
	}, "Time tracking period retrieved")
}

func (rs *Resource) getOwnOverview(w http.ResponseWriter, r *http.Request) {
	respondOwnView(rs, w, r, rs.ownViews.ClockOverview, "Time tracking overview retrieved")
}

func (rs *Resource) getOwnLeaveOverview(w http.ResponseWriter, r *http.Request) {
	respondOwnView(rs, w, r, rs.ownViews.LeaveOverview, "Time tracking leave overview retrieved")
}

func respondOwnView[T any](rs *Resource, w http.ResponseWriter, r *http.Request, read func(context.Context, int64) (T, error), message string) {
	ctx := r.Context()
	staffID, err := rs.getStaffIDFromClaims(ctx, rs.identity(ctx))
	if err != nil {
		common.RenderError(w, r, ownStaffError(err))
		return
	}
	data, err := read(ctx, staffID)
	switch {
	case errors.Is(err, workforce.ErrInvalidOwnTimePeriod):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		common.Respond(w, r, http.StatusOK, data, message)
	}
}
