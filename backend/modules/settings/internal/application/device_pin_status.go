package config

import (
	"context"

	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// DevicePINStatus tells the school leadership whether the tablets still need
// a device PIN of the school's own (#7175): NFC-Anwesenheit is booked and the
// PIN is empty or easy to guess. Like HomeLayout it is a capability of the
// settings service outside the legacy tenant operations, and it answers a flag
// and a reason, never the PIN. It reads in the request's tenant transaction.
func (s *settingsService) DevicePINStatus(ctx context.Context) (any, error) {
	booked, err := s.ResolveBool(ctx, configModel.KeyModuleNFCAnwesenheit)
	if err != nil {
		return nil, err
	}
	if !booked {
		return configModel.DevicePINStatusOf(false, ""), nil
	}
	pin, err := s.ResolveString(ctx, configModel.KeyOGSDevicePIN)
	if err != nil {
		return nil, err
	}
	return configModel.DevicePINStatusOf(true, pin), nil
}
