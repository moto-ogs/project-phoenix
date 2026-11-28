package staffshifts

import (
	"context"
	"net/http"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// BreakDayShifts lists the series shifts left on closing days and in the
// Ferien (#8205); workforce.SeriesBreakDays satisfies it.
type BreakDayShifts interface {
	BreakDayShifts(ctx context.Context) ([]workforce.SeriesBreakDayShift, error)
}

// listBreakDayShifts handles GET /api/staff-shifts/break-day-shifts: the
// planned shifts of series that leave out Ferien and closing days, standing
// on such a day from tomorrow on (#8205). The Dienstplan lists them under
// „Schichten an Schließtagen“ and warns at each one.
func (rs *Resource) listBreakDayShifts(w http.ResponseWriter, r *http.Request) {
	shifts, err := rs.breakDays.BreakDayShifts(r.Context())
	if err != nil {
		rs.runtime.Failure(w, r, FailureInternal, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, shifts, "Break day shifts retrieved")
}
