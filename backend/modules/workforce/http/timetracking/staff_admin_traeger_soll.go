package timetracking

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// sollKeptByTraeger reports whether a contract of the Träger governs the
// Soll of the staff member (#4706). Without the Träger side wired (tests of
// a school alone) nothing is kept.
func (rs *StaffAdminResource) sollKeptByTraeger(r *http.Request, staffID int64) (bool, error) {
	if rs.traegerKeep == nil {
		return false, nil
	}
	return rs.traegerKeep.StaffSollKeptByTraeger(r.Context(), staffID)
}

// refuseSollKeptByTraeger answers 409 when the Träger keeps the Soll: the
// school then reads its schedule and Ferien-Soll but changes neither
// (ADR 0089 section 6). It reports whether the write may go on.
func (rs *StaffAdminResource) refuseSollKeptByTraeger(w http.ResponseWriter, r *http.Request, staffID int64) bool {
	kept, err := rs.sollKeptByTraeger(r, staffID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return false
	}
	if kept {
		common.RenderError(w, r, common.ErrorConflictWithCode(workforce.ErrStaffSollKeptByTraeger, common.CodeWorkforceStaffSollKeptByTraeger))
		return false
	}
	return true
}

// withSollKeep marks a schedule answer the Träger keeps. The current
// schedule read already tells it for a schedule with rows; only an empty
// one (a contract that ends, nothing open) asks again.
func (rs *StaffAdminResource) withSollKeep(r *http.Request, staffID int64, resp *ScheduleResponse) error {
	if resp.KeptByTraeger || len(resp.Entries) > 0 {
		return nil
	}
	kept, err := rs.sollKeptByTraeger(r, staffID)
	if err != nil {
		return errors.Join(errors.New("read the Träger's Soll"), err)
	}
	resp.KeptByTraeger = kept
	return nil
}
