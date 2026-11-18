package devices

import (
	"errors"
	"net/http"
)

// DeviceSlotsResponse is the Geräteplatz state of the school (#2312).
// DeviceSlots and Free are null while moto has not set a limit; Occupied
// counts the registered, not removed devices, blocked ones included.
type DeviceSlotsResponse struct {
	DeviceSlots *int `json:"device_slots"`
	Occupied    int  `json:"occupied"`
	Free        *int `json:"free"`
}

// getDeviceSlots answers how many Geräteplätze the school bought and how
// many of them its devices occupy.
func (rs *Resource) getDeviceSlots(w http.ResponseWriter, r *http.Request) {
	if rs.runtime.DeviceSlots == nil {
		rs.runtime.Failure(w, r, http.StatusInternalServerError, errors.New("device slots are not composed"), "")
		return
	}
	usage, err := rs.runtime.DeviceSlots.DeviceSlotUsage(r.Context())
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusInternalServerError, err, "")
		return
	}
	response := DeviceSlotsResponse{Occupied: usage.Occupied}
	if usage.Limited {
		booked, free := usage.Booked, usage.Free()
		response.DeviceSlots, response.Free = &booked, &free
	}
	rs.runtime.Success(w, r, http.StatusOK, response, "Device slots retrieved successfully")
}
