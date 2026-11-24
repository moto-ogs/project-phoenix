package devices

import (
	"context"
	"errors"
	"net/http"

	validation "github.com/go-ozzo/ozzo-validation"
	devicefleet "github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// DeviceResponse represents a device API response
type DeviceResponse struct {
	ID             ident.ID  `json:"id"`
	DeviceID       string    `json:"device_id" contract_text:"device provisioning key, not the numeric device row ID"`
	DeviceType     string    `json:"device_type"`
	Name           *string   `json:"name,omitempty"`
	Status         string    `json:"status"`
	LastSeen       *WireTime `json:"last_seen,omitempty"`
	RegisteredByID *ident.ID `json:"registered_by_id,omitempty"`
	RoomName       *string   `json:"room_name,omitempty"`
	IsOnline       bool      `json:"is_online"`
	CreatedAt      WireTime  `json:"created_at"`
	UpdatedAt      WireTime  `json:"updated_at"`
	// Version is the read-state token of the device's edit (ADR 0311): an
	// update sends it back as expected_version.
	Version string `json:"version"`
}

// DeviceCreationResponse represents a device creation response with API key
type DeviceCreationResponse struct {
	DeviceResponse
	APIKey string `json:"api_key"` // Only included during creation
}

// DeviceRequest represents a device creation/update request
type DeviceRequest struct {
	DeviceID       string    `json:"device_id" contract_text:"device provisioning key, not the numeric device row ID"`
	DeviceType     string    `json:"device_type"`
	Name           *string   `json:"name,omitempty"`
	Status         string    `json:"status,omitempty"`
	RegisteredByID *ident.ID `json:"registered_by_id,omitempty"`
}

// DeviceUpdateRequest is the body of PUT /api/iot/{id}: the device as its
// editor read it, with the version of that read (ADR 0311).
type DeviceUpdateRequest struct {
	DeviceRequest
	ExpectedVersion string `json:"expected_version"`
}

// Bind validates the device request
func (req *DeviceRequest) Bind(_ *http.Request) error {
	if err := validation.ValidateStruct(req,
		validation.Field(&req.DeviceID, validation.Required),
		validation.Field(&req.DeviceType, validation.Required),
	); err != nil {
		return err
	}

	// Validate status only if provided
	if req.Status != "" {
		if !isValidDeviceStatus(devicefleet.DeviceStatus(req.Status)) {
			return errors.New("invalid device status")
		}
	}

	return nil
}

// DeviceStatusRequest represents a device status update request
type DeviceStatusRequest struct {
	Status string `json:"status"`
}

// Bind validates the device status request
func (req *DeviceStatusRequest) Bind(_ *http.Request) error {
	return validation.ValidateStruct(req,
		validation.Field(&req.Status, validation.Required, validation.In(
			string(devicefleet.DeviceStatusActive),
			string(devicefleet.DeviceStatusInactive),
			string(devicefleet.DeviceStatusMaintenance),
			string(devicefleet.DeviceStatusOffline),
		)),
	)
}

// newDeviceResponse converts a device model to a response object. The
// online/offline decision is resolved by the IoT service (issue #586, Rule 12)
// rather than the model.
func newDeviceResponse(ctx context.Context, svc devicefleet.DeviceOnlineMonitoring, device *devicefleet.Device) DeviceResponse {
	response := DeviceResponse{
		ID:             ident.ID(device.ID),
		DeviceID:       device.DeviceID,
		DeviceType:     device.DeviceType,
		Name:           device.Name,
		Status:         string(device.Status),
		RegisteredByID: (*ident.ID)(device.RegisteredByID),
		RoomName:       device.RoomName,
		IsOnline:       svc.IsDeviceOnline(ctx, device),
		CreatedAt:      WireTime(device.CreatedAt),
		UpdatedAt:      WireTime(device.UpdatedAt),
		Version:        devicefleet.DeviceVersion(device),
	}

	if device.LastSeen != nil {
		lastSeen := WireTime(*device.LastSeen)
		response.LastSeen = &lastSeen
	}

	return response
}

// newDeviceResponses converts a slice of device models to response objects
func newDeviceResponses(ctx context.Context, svc devicefleet.DeviceOnlineMonitoring, devices []*devicefleet.Device) []DeviceResponse {
	responses := make([]DeviceResponse, 0, len(devices))
	for _, device := range devices {
		responses = append(responses, newDeviceResponse(ctx, svc, device))
	}
	return responses
}

// newDeviceCreationResponse combines persisted metadata with the credential
// issued by creation. A database read never supplies the one-time key.
func newDeviceCreationResponse(ctx context.Context, svc devicefleet.DeviceOnlineMonitoring, device *devicefleet.Device, apiKey *string) DeviceCreationResponse {
	response := DeviceCreationResponse{
		DeviceResponse: newDeviceResponse(ctx, svc, device),
	}

	// Include API key only during creation
	if apiKey != nil {
		response.APIKey = *apiKey
	}

	return response
}

// isValidDeviceStatus validates a device status value
func isValidDeviceStatus(status devicefleet.DeviceStatus) bool {
	switch status {
	case devicefleet.DeviceStatusActive, devicefleet.DeviceStatusInactive, devicefleet.DeviceStatusMaintenance, devicefleet.DeviceStatusOffline:
		return true
	}
	return false
}
