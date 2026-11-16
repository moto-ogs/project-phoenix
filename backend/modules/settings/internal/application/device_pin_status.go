package config

import (
	"context"

	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// devicePINSettings are the two reads the device PIN status needs.
type devicePINSettings interface {
	ResolveBool(ctx context.Context, key string) (bool, error)
	ResolveString(ctx context.Context, key string) (string, error)
}

// DevicePINStatus tells the school leadership whether the tablets still need
// a device PIN of the school's own (#7175). It is its own capability, apart
// from the legacy tenant settings operations, and answers a flag and a reason,
// never the PIN.
type DevicePINStatus struct {
	settings devicePINSettings
}

// NewDevicePINStatus requires the settings reads at construction.
func NewDevicePINStatus(settings devicePINSettings) *DevicePINStatus {
	if settings == nil {
		panic("device PIN status: settings service is required")
	}
	return &DevicePINStatus{settings: settings}
}

// DevicePINStatus resolves NFC-Anwesenheit and the PIN in the request's
// tenant transaction.
func (s *DevicePINStatus) DevicePINStatus(ctx context.Context) (any, error) {
	booked, err := s.settings.ResolveBool(ctx, configModel.KeyModuleNFCAnwesenheit)
	if err != nil {
		return nil, err
	}
	if !booked {
		return configModel.DevicePINStatusOf(false, ""), nil
	}
	pin, err := s.settings.ResolveString(ctx, configModel.KeyOGSDevicePIN)
	if err != nil {
		return nil, err
	}
	return configModel.DevicePINStatusOf(true, pin), nil
}
