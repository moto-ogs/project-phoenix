package devices

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	devicefleet "github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

const (
	msgDevicesRetrieved       = "Devices retrieved successfully"
	errMsgInvalidDeviceID     = "invalid device ID"
	errMsgDeviceIDRequired    = "device ID is required"
	errMsgDeviceTypeRequired  = "device type is required"
	errMsgStatusRequired      = "status is required"
	errMsgInvalidPersonID     = "invalid person ID"
	errMsgInvalidDeviceStatus = "invalid device status"
)

// listDevices handles listing all devices with optional filtering
func (rs *Resource) listDevices(w http.ResponseWriter, r *http.Request) {
	// Get filter parameters
	deviceType := r.URL.Query().Get("device_type")
	status := r.URL.Query().Get("status")
	registeredByID := r.URL.Query().Get("registered_by_id")
	search := r.URL.Query().Get("search")

	// Create filters map
	filters := devicefleet.DeviceFilter{}

	// Apply filters
	if deviceType != "" {
		filters.DeviceType = &deviceType
	}

	if status != "" {
		value := devicefleet.DeviceStatus(status)
		filters.Status = &value
	}

	if registeredByID != "" {
		if id, err := strconv.ParseInt(registeredByID, 10, 64); err == nil {
			filters.RegisteredByID = &id
		}
	}

	if search != "" {
		filters.DeviceIDContains = &search
	}

	// Get devices
	devices, err := rs.IoTService.ListDevices(r.Context(), filters)
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusInternalServerError, err, "")
		return
	}

	// Build response
	responses := newDeviceResponses(r.Context(), rs.IoTService, devices)

	rs.runtime.Success(w, r, http.StatusOK, responses, msgDevicesRetrieved)
}

// getDevice handles getting a device by ID
func (rs *Resource) getDevice(w http.ResponseWriter, r *http.Request) {
	// Parse ID from URL
	id, err := rs.runtime.ParseID(r, "id")
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusBadRequest, errors.New(errMsgInvalidDeviceID), "")
		return
	}

	// Get device
	device, err := rs.IoTService.GetDeviceByID(r.Context(), id)
	if err != nil {
		rs.renderError(w, r, err)
		return
	}

	rs.runtime.Success(w, r, http.StatusOK, newDeviceResponse(r.Context(), rs.IoTService, device), "Device retrieved successfully")
}

// createDevice handles creating a new device
func (rs *Resource) createDevice(w http.ResponseWriter, r *http.Request) {
	// Parse request
	req := &DeviceRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.runtime.Failure(w, r, http.StatusBadRequest, err, "")
		return
	}

	// Create device model
	device := &devicefleet.Device{
		DeviceID:       req.DeviceID,
		DeviceType:     req.DeviceType,
		Name:           req.Name,
		RegisteredByID: (*int64)(req.RegisteredByID),
	}

	// Set status if provided, otherwise default to active
	if req.Status != "" {
		device.Status = devicefleet.DeviceStatus(req.Status)
	} else {
		device.Status = devicefleet.DeviceStatusActive
	}

	// Create device
	// The creation records itself in the device's history (#2321).
	if err := rs.IoTService.CreateDevice(rs.recordingContext(r), device); err != nil {
		rs.renderError(w, r, err)
		return
	}

	// Creation already replaces device with INSERT ... RETURNING *.
	// Keep the read when room enrichment or live-row filtering is needed.
	createdDevice := device
	if device.RoomID != nil || device.ArchivedAt != nil {
		var err error
		createdDevice, err = rs.IoTService.GetDeviceByID(r.Context(), device.ID)
		if err != nil {
			rs.renderError(w, r, err)
			return
		}
	}

	w.Header().Set("Cache-Control", "no-store")
	rs.runtime.Success(w, r, http.StatusCreated, newDeviceCreationResponse(r.Context(), rs.IoTService, createdDevice, device.APIKey), "Device created successfully")
}

// updateDevice handles updating an existing device
func (rs *Resource) updateDevice(w http.ResponseWriter, r *http.Request) {
	// Parse ID from URL
	id, err := rs.runtime.ParseID(r, "id")
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusBadRequest, errors.New(errMsgInvalidDeviceID), "")
		return
	}

	// Parse request
	req := &DeviceUpdateRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.runtime.Failure(w, r, http.StatusBadRequest, err, "")
		return
	}

	// Lock the live row first: the audit and the history entry then describe
	// the committed row (#2317, #2321); deviceForEdit says why.
	device, err := rs.deviceForEdit(r, id)
	if err != nil {
		rs.renderError(w, r, err)
		return
	}

	// Update fields
	previousStatus := device.Status
	device.DeviceID = req.DeviceID
	device.DeviceType = req.DeviceType
	device.Name = req.Name
	device.RegisteredByID = (*int64)(req.RegisteredByID)
	// An omitted status keeps the stored one; the edit then does not write
	// the status this request read, which may already be outdated.
	device.Status = devicefleet.DeviceStatus(req.Status)

	// Update device
	// The edit records its material changes in the device's history (#2321).
	if err := rs.IoTService.UpdateDevice(rs.recordingContext(r), device, req.ExpectedVersion); err != nil {
		rs.renderError(w, r, err)
		return
	}

	if req.Status != "" && device.Status != previousStatus {
		rs.runtime.AuditStatusChange(r, StatusAudit{DeviceRowID: device.ID, DeviceID: device.DeviceID, From: previousStatus, To: device.Status})
	}

	// The owner write already returned the locked stored row. Refresh the
	// room through the owner, but retain the original archived-row read path.
	updatedDevice := device
	if device.ArchivedAt != nil {
		updatedDevice, err = rs.IoTService.GetDeviceByID(r.Context(), device.ID)
	} else if device.RoomID != nil {
		updatedDevice.RoomName, err = rs.IoTService.GetPersistedDeviceRoomName(r.Context(), device)
	}
	if err != nil {
		rs.renderError(w, r, err)
		return
	}

	rs.runtime.Success(w, r, http.StatusOK, newDeviceResponse(r.Context(), rs.IoTService, updatedDevice), "Device updated successfully")
}

// deleteDevice removes a device from the fleet (#2319): the row stays as
// archived history, access ends and its Geräteplatz is released. An open
// kiosk session blocks the removal and stays untouched.
func (rs *Resource) deleteDevice(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r, "id")
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusBadRequest, errors.New(errMsgInvalidDeviceID), "")
		return
	}
	device, session, err := rs.removalPreflight(r, id)
	if errors.Is(err, devicefleet.ErrAdministrationDeviceProtected) {
		rs.runtime.AuditRemoval(r, RemovalAudit{DeviceRowID: device.ID, DeviceID: device.DeviceID, Outcome: RemovalOutcomeProtected})
	}
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	if session != nil {
		rs.runtime.AuditRemoval(r, RemovalAudit{DeviceRowID: device.ID, DeviceID: device.DeviceID, Outcome: RemovalOutcomeActiveSession, SessionID: &session.ID})
		rs.runtime.ConflictWithDetails(w, r, errors.New("device has an active session and cannot be removed"), codeDeviceInActiveSession, DeviceInActiveSessionDetails{
			SessionID: ident.ID(session.ID),
			RoomID:    ident.ID(session.RoomID),
			StartedAt: session.StartedAt.Format(time.RFC3339),
		})
		return
	}
	if err := rs.IoTService.DeleteDevice(r.Context(), id); err != nil {
		rs.renderError(w, r, err)
		return
	}
	if err := rs.recordLifecycle(r, device.ID, devicefleet.LifecycleRemoved, nil); err != nil {
		rs.runtime.Failure(w, r, http.StatusInternalServerError, err, "")
		return
	}
	rs.runtime.AuditRemoval(r, RemovalAudit{DeviceRowID: device.ID, DeviceID: device.DeviceID, Outcome: RemovalOutcomeRemoved})
	rs.runtime.Success(w, r, http.StatusOK, nil, "Device removed successfully")
}

// removalPreflight locks the live device row and reads its open kiosk
// session. The lock comes first: a session start locks the same row
// (devicescanbinding lifecycleStore.Start), so a start and a removal never
// interleave. An already removed device is not found, so a repeated removal
// changes nothing and releases no second Geräteplatz.
func (rs *Resource) removalPreflight(r *http.Request, id int64) (devicefleet.Device, *RemovalSession, error) {
	device, err := rs.IoTService.Fleet().FindDeviceForUpdate(r.Context(), id)
	if errors.Is(err, devicefleet.ErrDeviceNotFound) {
		return devicefleet.Device{}, nil, &devicefleet.AdministrationError{Op: "DeleteDevice", Err: devicefleet.ErrAdministrationDeviceNotFound}
	}
	if err != nil {
		return devicefleet.Device{}, nil, err
	}
	if device.DeviceID == devicefleet.WebManualDeviceID {
		return device, nil, &devicefleet.AdministrationError{Op: "DeleteDevice", Err: devicefleet.ErrAdministrationDeviceProtected}
	}
	session, err := rs.runtime.ActiveSession(r.Context(), device.ID)
	return device, session, err
}

// deviceIDParam reads the hardware device ID from the path. Chi routes on
// the escaped path when the client escaped a character such as the colon of
// a MAC address; only then is the parameter still escaped and unescaped
// here once. An invalid escape yields an empty ID, which the handlers reject.
func deviceIDParam(r *http.Request) string {
	id := chi.URLParam(r, "deviceId")
	if r.URL.RawPath == "" {
		return id
	}
	unescaped, err := url.PathUnescape(id)
	if err != nil {
		return ""
	}
	return unescaped
}

// updateDeviceStatus sets the status of a live device. "inactive" blocks
// it (Gerätesperre, #2317): device authentication then refuses its kiosk
// with iot.device_inactive, while the device keeps its row, room, history,
// credential and Geräteplatz. "active" unblocks it with the same
// credential. The row stays locked from the read to the write; setting the
// status the device already has changes nothing and records no audit entry.
func (rs *Resource) updateDeviceStatus(w http.ResponseWriter, r *http.Request) {
	deviceID := deviceIDParam(r)
	if deviceID == "" {
		rs.runtime.Failure(w, r, http.StatusBadRequest, errors.New(errMsgDeviceIDRequired), "")
		return
	}
	req := &DeviceStatusRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.runtime.Failure(w, r, http.StatusBadRequest, err, "")
		return
	}
	device, err := rs.lockDeviceByDeviceID(r, deviceID)
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	status := devicefleet.DeviceStatus(req.Status)
	if device.Status != status {
		if err := rs.IoTService.UpdateDeviceStatus(r.Context(), deviceID, status); err != nil {
			rs.renderError(w, r, err)
			return
		}
		rs.runtime.AuditStatusChange(r, StatusAudit{DeviceRowID: device.ID, DeviceID: device.DeviceID, From: device.Status, To: status})
		if err := rs.recordLifecycle(r, device.ID, statusLifecycleAction(status), statusChange(device.Status, status)); err != nil {
			rs.runtime.Failure(w, r, http.StatusInternalServerError, err, "")
			return
		}
	}
	rs.runtime.Success(w, r, http.StatusOK, nil, "Device status updated successfully")
}

// lockDeviceByDeviceID finds the school's live device by its hardware ID
// and locks its row for the status write. The manual web check-in device is
// protected.
func (rs *Resource) lockDeviceByDeviceID(r *http.Request, deviceID string) (devicefleet.Device, error) {
	found, err := rs.IoTService.GetDeviceByDeviceID(r.Context(), deviceID)
	if err != nil {
		return devicefleet.Device{}, err
	}
	if found.DeviceID == devicefleet.WebManualDeviceID {
		return devicefleet.Device{}, &devicefleet.AdministrationError{Op: "UpdateDeviceStatus", Err: devicefleet.ErrAdministrationDeviceProtected}
	}
	device, err := rs.lockLiveDevice(r, "UpdateDeviceStatus", found.ID)
	if err == nil && device.DeviceID != found.DeviceID {
		// Renamed between the lookup and the lock: the hardware ID now names
		// no device this lock holds.
		return devicefleet.Device{}, &devicefleet.AdministrationError{Op: "UpdateDeviceStatus", Err: devicefleet.ErrAdministrationDeviceNotFound}
	}
	return device, err
}

// deviceForEdit reads the device an edit changes and locks its live row in
// the same statement. A block committed meanwhile is not overwritten
// unnoticed (#2317), and a removal committed while the edit waited answers
// 404 without a history entry from the snapshot before it (#2321). The
// owner's UpdateDevice refuses an edit of an older read under this lock
// (ADR 0311).
func (rs *Resource) deviceForEdit(r *http.Request, id int64) (*devicefleet.Device, error) {
	device, err := rs.lockLiveDevice(r, "UpdateDevice", id)
	if err != nil {
		return nil, err
	}
	return &device, nil
}

// lockLiveDevice locks the school's live device row for a write; a removed
// or foreign device is not found.
func (rs *Resource) lockLiveDevice(r *http.Request, op string, id int64) (devicefleet.Device, error) {
	device, err := rs.IoTService.Fleet().FindDeviceForUpdate(r.Context(), id)
	if errors.Is(err, devicefleet.ErrDeviceNotFound) {
		return devicefleet.Device{}, &devicefleet.AdministrationError{Op: op, Err: devicefleet.ErrAdministrationDeviceNotFound}
	}
	return device, err
}
