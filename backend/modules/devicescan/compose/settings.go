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
// with the retained presence service, which validates the value; its
// GetPresenceMode is promoted unchanged.
type settings struct {
	settings ScanSettings
	presenceModes
	stops MoodCaptureStops
}

// MoodCaptureStops tells whether a child's mood capture is stopped (#3844);
// the root binds it to Student Presence's per-child stop.
type MoodCaptureStops = application.MoodCaptureStops

type presenceModes interface {
	GetPresenceMode(ctx context.Context) (string, error)
}

func (s settings) FeedbackEnabled(ctx context.Context) (bool, error) {
	return application.FeedbackEnabledBinding(ctx, s.settings)
}

// FeedbackEnabledFor offers the mood prompt only when the school takes
// feedback and the child is not stopped (#3844).
func (s settings) FeedbackEnabledFor(ctx context.Context, studentID int64) (bool, error) {
	return application.FeedbackEnabledForBinding(ctx, s.settings, s.stops, studentID)
}

func (s settings) CapacityDetailsDisclosed(ctx context.Context, kind ports.CapacityKind) (bool, error) {
	return application.CapacityDetailsDisclosedBinding(ctx, s.settings, kind)
}

// DailyCheckoutTime resolves the tenant override or registry default.
func (s settings) DailyCheckoutTime(ctx context.Context) (string, error) {
	return application.DailyCheckoutTimeBinding(ctx, s.settings)
}

func (s settings) PerStudentCheckoutEnabled(ctx context.Context) (bool, error) {
	return application.PerStudentCheckoutEnabledBinding(ctx, s.settings)
}

func (s settings) PerStudentCheckoutDeltaMinutes(ctx context.Context) (int, error) {
	return application.PerStudentCheckoutDeltaMinutesBinding(ctx, s.settings)
}

func (s settings) DailyCheckoutFromAllRoomsEnabled(ctx context.Context) (bool, error) {
	return application.DailyCheckoutFromAllRoomsEnabledBinding(ctx, s.settings)
}
