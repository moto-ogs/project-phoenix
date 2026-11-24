package devicefleet

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Error message constants to avoid string duplication
const (
	errDeviceIDEmpty = "device ID cannot be empty"
)

func isProtectedSystemDevice(device *Device) bool {
	return device != nil && device.DeviceID == WebManualDeviceID
}

// service implements the Service interface on top of the owner capability.
type administration struct {
	devices Capability
	// now is the composition's clock: a new device and a ping are last
	// seen at it.
	now func() time.Time
}

// NewAdministration creates a new IoT service over the Device Fleet
// capability and the composition's clock.
func NewAdministration(devices Capability, now func() time.Time) Administration {
	if devices == nil {
		panic("iot service: device fleet capability is required")
	}
	if now == nil {
		panic("iot service: the clock is required")
	}
	return &administration{devices: devices, now: now}
}

// Fleet exposes the owner this service delegates to.
func (s *administration) Fleet() Capability { return s.devices }

// IsDeviceOnline reports whether the device is currently online.
func (s *administration) IsDeviceOnline(ctx context.Context, device *Device) bool {
	return s.IsDeviceOnlineAt(ctx, device, s.now())
}

// IsLastSeenOnline reports whether a device last seen at lastSeen counts as
// online right now. Device-authenticated handlers hold the principal, not
// the row, so they ask by timestamp.
func (s *administration) IsLastSeenOnline(ctx context.Context, lastSeen *time.Time) bool {
	return s.devices.IsDeviceOnline(ctx, Device{LastSeen: lastSeen})
}

// IsDeviceOnlineAt reports whether the device was online at the supplied
// observation time.
func (s *administration) IsDeviceOnlineAt(ctx context.Context, device *Device, now time.Time) bool {
	if device == nil {
		return false
	}
	return s.devices.IsDeviceOnlineAt(ctx, *device, now)
}

// DeviceOnlineWindow resolves the per-tenant device-online window.
func (s *administration) DeviceOnlineWindow(ctx context.Context) time.Duration {
	return s.devices.DeviceOnlineWindow(ctx)
}

// CreateDevice creates a new IoT device.
func (s *administration) CreateDevice(ctx context.Context, device *Device) error {
	if device == nil {
		return &AdministrationError{Op: "CreateDevice", Err: ErrAdministrationInvalidDeviceData}
	}
	if err := validateAdministrationDevice(device); err != nil {
		return &AdministrationError{Op: "CreateDevice", Err: err}
	}

	// The table's unique index alone decides a taken device_id, so a
	// concurrent registration cannot slip past a check before the insert
	// (#2312); its violation comes back as ErrDuplicateDeviceID.
	if device.Status == "" {
		device.Status = DeviceStatusActive
	}
	if device.LastSeen == nil {
		now := s.now()
		device.LastSeen = &now
	}

	created, err := s.devices.CreateDevice(ctx, CreateDevice{
		DeviceID: device.DeviceID, DeviceType: device.DeviceType, Name: device.Name,
		Status: DeviceStatus(device.Status), APIKey: device.APIKey, APIKeyHash: device.APIKeyHash, MaskedAPIKey: device.MaskedAPIKey,
		LastSeen: device.LastSeen, RegisteredByID: device.RegisteredByID, RoomID: device.RoomID,
		RecordedBy: recordedBy(ctx),
	})
	if errors.Is(err, ErrDuplicateDeviceID) {
		return &AdministrationError{Op: "CreateDevice", Err: &AdministrationDuplicateDeviceIDError{DeviceID: device.DeviceID}}
	}
	if err != nil {
		return &AdministrationError{Op: "CreateDevice", Err: err}
	}
	*device = *administrationDevicePointer(created)
	return nil
}

// GetDeviceByID retrieves a device by its ID.
func (s *administration) GetDeviceByID(ctx context.Context, id int64) (*Device, error) {
	if id <= 0 {
		return nil, &AdministrationError{Op: "GetDeviceByID", Err: errors.New("invalid ID")}
	}
	device, err := s.devices.FindDevice(ctx, id)
	if err != nil {
		if errors.Is(err, ErrDeviceNotFound) {
			return nil, &AdministrationError{Op: "GetDeviceByID", Err: ErrAdministrationDeviceNotFound}
		}
		return nil, &AdministrationError{Op: "GetDeviceByID", Err: err}
	}
	return administrationDevicePointer(device), nil
}

// GetPersistedDeviceRoomName resolves only the current room projection of
// this transaction's trusted write result. Preserve the former readback's
// GetDeviceByID wrapper and not-found mapping, not a new HTTP error identity.
func (s *administration) GetPersistedDeviceRoomName(ctx context.Context, device *Device) (*string, error) {
	if device == nil || device.ID <= 0 {
		return nil, &AdministrationError{Op: "GetDeviceByID", Err: errors.New("invalid ID")}
	}
	name, err := s.devices.DeviceRoomName(ctx, *device)
	if err != nil {
		if errors.Is(err, ErrDeviceNotFound) {
			return nil, &AdministrationError{Op: "GetDeviceByID", Err: ErrAdministrationDeviceNotFound}
		}
		return nil, &AdministrationError{Op: "GetDeviceByID", Err: err}
	}
	return name, nil
}

// GetDeviceByDeviceID retrieves a device by its device ID.
func (s *administration) GetDeviceByDeviceID(ctx context.Context, deviceID string) (*Device, error) {
	if deviceID == "" {
		return nil, &AdministrationError{Op: "GetDeviceByDeviceID", Err: errors.New(errDeviceIDEmpty)}
	}
	device, err := s.devices.FindDeviceByDeviceID(ctx, deviceID)
	if errors.Is(err, ErrDeviceNotFound) {
		return nil, &AdministrationError{Op: "GetDeviceByDeviceID", Err: ErrAdministrationDeviceNotFound}
	}
	if err != nil {
		return nil, &AdministrationError{Op: "GetDeviceByDeviceID", Err: err}
	}
	if device.ID <= 0 {
		return nil, &AdministrationError{Op: "GetDeviceByDeviceID", Err: &AdministrationDeviceNotFoundError{DeviceID: deviceID}}
	}
	return administrationDevicePointer(device), nil
}

// UpdateDevice applies a school's edit to an existing IoT device. It writes
// only the fields that edit owns (device_id, device_type, name,
// registered_by_id, and status when the caller names one): the API key,
// last_seen, room, archive and transfer columns belong to other flows, and
// the edit must not revert a key rotation, deactivation or transfer. An empty status keeps the stored one. The
// edit writes back what its editor read: a device whose edited fields
// differ from expectedVersion is refused with readstate.ErrChanged (ADR
// 0311). The check reads the device under its row lock, so it and the
// write see the same row whatever the caller locked before; a second lock
// of the row in the same unit costs nothing.
func (s *administration) UpdateDevice(ctx context.Context, device *Device, expectedVersion string) error {
	if device == nil || device.ID <= 0 {
		return &AdministrationError{Op: "UpdateDevice", Err: ErrAdministrationInvalidDeviceData}
	}
	// Read before validation, which defaults an empty status.
	editsStatus := device.Status != ""
	if err := validateAdministrationDevice(device); err != nil {
		return &AdministrationError{Op: "UpdateDevice", Err: err}
	}

	existing, err := s.devices.FindDeviceForUpdate(ctx, device.ID)
	if errors.Is(err, ErrDeviceNotFound) {
		return &AdministrationError{Op: "UpdateDevice", Err: ErrAdministrationDeviceNotFound}
	}
	if err != nil {
		return &AdministrationError{Op: "UpdateDevice", Err: err}
	}
	if existing.ID <= 0 {
		return &AdministrationError{Op: "UpdateDevice", Err: ErrAdministrationDeviceNotFound}
	}
	if isProtectedSystemDevice(administrationDevicePointer(existing)) {
		return &AdministrationError{Op: "UpdateDevice", Err: ErrAdministrationDeviceProtected}
	}
	if err := readstate.Check(expectedVersion, DeviceVersion(&existing)); err != nil {
		return err
	}

	if existing.DeviceID != device.DeviceID {
		duplicate, dupErr := s.devices.FindDeviceByDeviceID(ctx, device.DeviceID)
		if dupErr == nil && duplicate.ID > 0 && duplicate.ID != device.ID {
			return &AdministrationError{Op: "UpdateDevice", Err: &AdministrationDuplicateDeviceIDError{DeviceID: device.DeviceID}}
		}
	}

	updated, err := s.writeDeviceEdit(ctx, device, editsStatus)
	if err != nil {
		return err
	}
	*device = *administrationDevicePointer(updated)
	return nil
}

// writeDeviceEdit stores the columns a school's edit owns, status only when
// the edit named one, and returns the device as stored afterwards, including
// the columns other flows wrote.
func (s *administration) writeDeviceEdit(ctx context.Context, device *Device, editsStatus bool) (Device, error) {
	var status *DeviceStatus
	if editsStatus {
		value := DeviceStatus(device.Status)
		status = &value
	}
	updated, err := s.devices.ApplyDeviceEdit(ctx, DeviceEdit{
		ID: device.ID, DeviceID: device.DeviceID, DeviceType: device.DeviceType, Name: device.Name,
		RegisteredByID: device.RegisteredByID, Status: status, RecordedBy: recordedBy(ctx),
	})
	if errors.Is(err, ErrDeviceNotFound) {
		return Device{}, &AdministrationError{Op: "UpdateDevice", Err: ErrAdministrationDeviceNotFound}
	}
	if err != nil {
		return Device{}, &AdministrationError{Op: "UpdateDevice", Err: err}
	}
	return updated, nil
}

// findDevice loads one device by primary key for op and reports a missing
// row as ErrAdministrationDeviceNotFound.
func (s *administration) findDevice(ctx context.Context, op string, id int64) (Device, error) {
	device, err := s.devices.FindDevice(ctx, id)
	if errors.Is(err, ErrDeviceNotFound) {
		return Device{}, &AdministrationError{Op: op, Err: ErrAdministrationDeviceNotFound}
	}
	if err != nil {
		return Device{}, &AdministrationError{Op: op, Err: err}
	}
	return device, nil
}

// DeleteDevice deletes an IoT device by its ID.
func (s *administration) DeleteDevice(ctx context.Context, id int64) error {
	if id <= 0 {
		return &AdministrationError{Op: "DeleteDevice", Err: errors.New("invalid ID")}
	}
	device, err := s.devices.FindDevice(ctx, id)
	if err != nil {
		if errors.Is(err, ErrDeviceNotFound) {
			return &AdministrationError{Op: "DeleteDevice", Err: ErrAdministrationDeviceNotFound}
		}
		return &AdministrationError{Op: "DeleteDevice", Err: err}
	}
	if device.ID <= 0 {
		return &AdministrationError{Op: "DeleteDevice", Err: ErrAdministrationDeviceNotFound}
	}
	if isProtectedSystemDevice(administrationDevicePointer(device)) {
		return &AdministrationError{Op: "DeleteDevice", Err: ErrAdministrationDeviceProtected}
	}
	if err := s.devices.DeleteDevice(ctx, id); err != nil {
		return &AdministrationError{Op: "DeleteDevice", Err: err}
	}
	return nil
}

// ListDevices retrieves devices based on filters. The reserved web-manual
// system device is excluded by default; callers can still fetch it explicitly
// by requesting device_type=virtual.
func (s *administration) ListDevices(ctx context.Context, filter DeviceFilter) ([]*Device, error) {
	if filter.DeviceType == nil {
		excluded := WebManualDeviceID
		filter.ExcludeDeviceID = &excluded
	}
	devices, err := s.devices.ListDevices(ctx, filter)
	if err != nil {
		return nil, &AdministrationError{Op: "ListDevices", Err: err}
	}
	return administrationDevicePointers(devices), nil
}

// UpdateDeviceStatus updates the status of a device.
func (s *administration) UpdateDeviceStatus(ctx context.Context, deviceID string, status DeviceStatus) error {
	if deviceID == "" {
		return &AdministrationError{Op: "UpdateDeviceStatus", Err: errors.New(errDeviceIDEmpty)}
	}
	if !ValidDeviceStatus(DeviceStatus(status)) {
		return &AdministrationError{Op: "UpdateDeviceStatus", Err: errors.New("invalid device status")}
	}

	existing, err := s.devices.FindDeviceByDeviceID(ctx, deviceID)
	if errors.Is(err, ErrDeviceNotFound) {
		return &AdministrationError{Op: "UpdateDeviceStatus", Err: ErrAdministrationDeviceNotFound}
	}
	if err != nil {
		return &AdministrationError{Op: "UpdateDeviceStatus", Err: err}
	}
	if existing.ID <= 0 {
		return &AdministrationError{Op: "UpdateDeviceStatus", Err: &AdministrationDeviceNotFoundError{DeviceID: deviceID}}
	}
	if isProtectedSystemDevice(administrationDevicePointer(existing)) {
		return &AdministrationError{Op: "UpdateDeviceStatus", Err: ErrAdministrationDeviceProtected}
	}
	if err := s.devices.UpdateDeviceStatus(ctx, deviceID, DeviceStatus(status)); err != nil {
		return &AdministrationError{Op: "UpdateDeviceStatus", Err: err}
	}
	return nil
}

type Administration interface {
	DeviceAdministration
	DeviceMonitoring
	DeviceDiscovery
	DeviceWriteRoomReadback
}

// DeviceWriteRoomReadback serves the native write response, not CRUD lookups.
// Its input must be the unmodified full owner write result in the same tenant
// transaction. Existing DeviceAdministration and its other callers stay unchanged.
type DeviceWriteRoomReadback interface {
	GetPersistedDeviceRoomName(context.Context, *Device) (*string, error)
}

// DeviceAdministration creates, edits and removes fleet devices.
type DeviceAdministration interface {
	// Core device operations
	CreateDevice(ctx context.Context, device *Device) error
	GetDeviceByID(ctx context.Context, id int64) (*Device, error)
	GetDeviceByDeviceID(ctx context.Context, deviceID string) (*Device, error)
	UpdateDevice(ctx context.Context, device *Device, expectedVersion string) error
	DeleteDevice(ctx context.Context, id int64) error
	ListDevices(ctx context.Context, filter DeviceFilter) ([]*Device, error)
	// Status operations
	UpdateDeviceStatus(ctx context.Context, deviceID string, status DeviceStatus) error
}

// DeviceMonitoring reads the online status of devices.
type DeviceMonitoring interface {
	DeviceOnlineMonitoring
}

// DeviceOnlineMonitoring evaluates online status for administration callers.
type DeviceOnlineMonitoring interface {
	// Online/offline decision (issue #586 — Rule 12). The window is resolved
	// by the Device Fleet owner from the per-tenant setting
	// device_online_window_minutes.
	DeviceOnlineWindow(ctx context.Context) time.Duration
	IsDeviceOnline(ctx context.Context, device *Device) bool
	IsDeviceOnlineAt(ctx context.Context, device *Device, now time.Time) bool
	IsLastSeenOnline(ctx context.Context, lastSeen *time.Time) bool
}

// DeviceDiscovery exposes device discovery and the composed fleet.
type DeviceDiscovery interface {
	// Fleet exposes the Device Fleet owner this service delegates to, so the
	// composition root binds one instance for every entry point (#2676).
	Fleet() Capability
}

func administrationDevicePointer(device Device) *Device { return &device }
func administrationDevicePointers(devices []Device) []*Device {
	result := make([]*Device, 0, len(devices))
	for _, device := range devices {
		result = append(result, administrationDevicePointer(device))
	}
	return result
}
func validateAdministrationDevice(device *Device) error {
	if device.DeviceID == "" {
		return errors.New("device ID is required")
	}
	if device.DeviceType == "" {
		return errors.New("device type is required")
	}
	if device.Status == "" {
		device.Status = DeviceStatusActive
	} else if !ValidDeviceStatus(device.Status) {
		return errors.New("invalid device status")
	}
	return nil
}

// recordedBy is the actor WithLifecycleActor set on ctx: a create or an edit
// made with it records itself in the device's history (#2321).
func recordedBy(ctx context.Context) *LifecycleActorRef {
	actor, _ := LifecycleActorFrom(ctx)
	return actor
}
