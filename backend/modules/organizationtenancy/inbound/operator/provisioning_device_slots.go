package operator

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// deviceSlotsRequest sets the Geräteplätze of a school (#2312): a number
// from 0 to the contract maximum, or null to remove the limit. The field is
// required, so a forgotten body never removes a limit by accident.
type deviceSlotsRequest struct {
	DeviceSlots *int `json:"device_slots"`
}

// decodeDeviceSlotsRequest reads the body and insists on the field.
func decodeDeviceSlotsRequest(r *http.Request) (deviceSlotsRequest, error) {
	var fields map[string]json.RawMessage
	if err := wire.Decode(r.Body, &fields); err != nil {
		return deviceSlotsRequest{}, fmt.Errorf("invalid request body: %w", err)
	}
	raw, ok := fields["device_slots"]
	if !ok {
		return deviceSlotsRequest{}, errors.New("device_slots is required")
	}
	var req deviceSlotsRequest
	if err := json.Unmarshal(raw, &req.DeviceSlots); err != nil {
		return deviceSlotsRequest{}, fmt.Errorf("device_slots: %w", err)
	}
	return req, nil
}

// SetSchoolDeviceSlots sets the Geräteplätze of a school (#2312). Lowering
// them below the registered devices is rejected; the answer carries no data,
// the school page reloads.
func (rs *ProvisioningResource) SetSchoolDeviceSlots(w http.ResponseWriter, r *http.Request) {
	schoolID, ok := common.ParseInt64IDWithError(w, r, "id", "invalid school ID")
	if !ok {
		return
	}
	req, err := decodeDeviceSlotsRequest(r)
	if err != nil {
		common.RenderError(w, r, common.OperatorInvalidRequest(err))
		return
	}
	if rs.deviceSlots == nil {
		common.RenderError(w, r, common.OperatorInternal(internalErrorMessage))
		return
	}
	operatorID := int64(sessiontoken.ClaimsFromCtx(r.Context()).ID)
	if err := rs.deviceSlots.SetSchoolDeviceSlots(r.Context(), schoolID, req.DeviceSlots, operatorID, common.ParseClientIP(r)); err != nil {
		common.RenderError(w, r, ProvisioningErrorRenderer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Device slots updated successfully")
}
