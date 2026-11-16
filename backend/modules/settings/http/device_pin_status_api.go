package settingshttp

import (
	"net/http"
)

// getDevicePINStatus tells a school admin whether the tablets still need a
// device PIN of the school's own (#7175). The tenant portal shows a notice
// that cannot be dismissed until the PIN is set.
func (rs *SettingsResource) getDevicePINStatus(w http.ResponseWriter, r *http.Request) {
	status, err := rs.devicePIN.DevicePINStatus(r.Context())
	if err != nil {
		rs.runtime.RenderError(w, r, http.StatusInternalServerError, err)
		return
	}
	rs.runtime.Respond(w, r, http.StatusOK, status, "Device PIN status retrieved successfully")
}
