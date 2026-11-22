package compose

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/devicescan/internal/application"

	"github.com/moto-ogs/project-phoenix/modules/devicescan/ports"
)

var errSettingsNotConfigured = application.ErrSettingsNotConfigured

// ScanSettings are the tenant settings the scans read; the root binds them
// to the Settings Platform.
type ScanSettings interface{ application.ScanSettings }

// settings binds the required tenant settings service. Presence mode stays
// with the retained presence service, which validates the value; it and the
// child's mood stop (#3844) are promoted unchanged.
type settings struct {
	ScanSettings
	presenceModes
}

type presenceModes interface {
	GetPresenceMode(ctx context.Context) (string, error)
}

func (s settings) FeedbackEnabled(ctx context.Context) (bool, error) {
	return application.FeedbackEnabledBinding(ctx, s.ScanSettings)
}

func (s settings) CapacityDetailsDisclosed(ctx context.Context, kind ports.CapacityKind) (bool, error) {
	return application.CapacityDetailsDisclosedBinding(ctx, s.ScanSettings, kind)
}

// DailyCheckoutTime resolves the tenant override or registry default.
func (s settings) DailyCheckoutTime(ctx context.Context) (string, error) {
	return application.DailyCheckoutTimeBinding(ctx, s.ScanSettings)
}

func (s settings) PerStudentCheckoutEnabled(ctx context.Context) (bool, error) {
	return application.PerStudentCheckoutEnabledBinding(ctx, s.ScanSettings)
}

func (s settings) PerStudentCheckoutDeltaMinutes(ctx context.Context) (int, error) {
	return application.PerStudentCheckoutDeltaMinutesBinding(ctx, s.ScanSettings)
}

func (s settings) DailyCheckoutFromAllRoomsEnabled(ctx context.Context) (bool, error) {
	return application.DailyCheckoutFromAllRoomsEnabledBinding(ctx, s.ScanSettings)
}
