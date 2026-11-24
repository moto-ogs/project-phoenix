package operator

import (
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
)

// BlockDevice blocks a device (Gerätesperre, #2317): it keeps its row,
// room, history and Geräteplatz, and its kiosk is refused until it is
// unblocked. Blocking a blocked device changes nothing.
func (rs *ProvisioningResource) BlockDevice(w http.ResponseWriter, r *http.Request) {
	rs.setDeviceBlocked(w, r, true, "Device blocked successfully")
}

// UnblockDevice gives a blocked device its access back (#2317).
func (rs *ProvisioningResource) UnblockDevice(w http.ResponseWriter, r *http.Request) {
	rs.setDeviceBlocked(w, r, false, "Device unblocked successfully")
}

func (rs *ProvisioningResource) setDeviceBlocked(w http.ResponseWriter, r *http.Request, blocked bool, message string) {
	deviceID, ok := common.ParseInt64IDWithError(w, r, "id", invalidDeviceIDMessage)
	if !ok {
		return
	}
	if rs.deviceBlocking == nil {
		common.RenderError(w, r, common.OperatorInternal(nil, internalErrorMessage))
		return
	}
	operatorID := int64(sessiontoken.ClaimsFromCtx(r.Context()).ID)
	if err := rs.deviceBlocking.SetDeviceBlocked(r.Context(), deviceID, blocked, operatorID, common.ParseClientIP(r)); err != nil {
		common.RenderError(w, r, ProvisioningErrorRenderer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, nil, message)
}
