package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/devicescan/ports"
)

var ErrSettingsNotConfigured = errors.New("settings service is not configured")

type ScanSettings interface {
	FeedbackEnabled(ctx context.Context) (bool, error)
	RoomCapacityDetailsDisclosed(ctx context.Context) (bool, error)
	ActivityCapacityDetailsDisclosed(ctx context.Context) (bool, error)
	DailyCheckoutTime(ctx context.Context) (string, error)
	PerStudentCheckoutEnabled(ctx context.Context) (bool, error)
	PerStudentCheckoutDeltaMinutes(ctx context.Context) (int, error)
	DailyCheckoutFromAllRoomsEnabled(ctx context.Context) (bool, error)
}

func FeedbackEnabledBinding(ctx context.Context, source ScanSettings) (bool, error) {
	if source == nil {
		return false, ErrSettingsNotConfigured
	}
	return source.FeedbackEnabled(ctx)
}

// MoodCaptureStops tells whether a child's mood capture is stopped (#3844).
type MoodCaptureStops interface {
	MoodCaptureStopped(ctx context.Context, studentID int64) (bool, error)
}

// FeedbackEnabledForBinding offers the mood prompt only when the school takes
// feedback and the child is not stopped. A stop that cannot be read, or no
// stop wiring, offers no prompt rather than omitting the flag, which the kiosk
// reads as on; the submission itself refuses such a child on its own.
func FeedbackEnabledForBinding(ctx context.Context, source ScanSettings, stops MoodCaptureStops, studentID int64) (bool, error) {
	enabled, err := FeedbackEnabledBinding(ctx, source)
	if err != nil || !enabled {
		return enabled, err
	}
	if stops == nil {
		return false, nil
	}
	stopped, err := stops.MoodCaptureStopped(ctx, studentID)
	return err == nil && !stopped, nil
}

func CapacityDetailsDisclosedBinding(ctx context.Context, source ScanSettings, kind ports.CapacityKind) (bool, error) {
	if source == nil {
		return false, ErrSettingsNotConfigured
	}
	if kind == ports.CapacityActivity {
		return source.ActivityCapacityDetailsDisclosed(ctx)
	}
	return source.RoomCapacityDetailsDisclosed(ctx)
}
func DailyCheckoutTimeBinding(ctx context.Context, source ScanSettings) (string, error) {
	if source == nil {
		return "", ErrSettingsNotConfigured
	}
	return source.DailyCheckoutTime(ctx)
}
func PerStudentCheckoutEnabledBinding(ctx context.Context, source ScanSettings) (bool, error) {
	if source == nil {
		return false, nil
	}
	return source.PerStudentCheckoutEnabled(ctx)
}
func PerStudentCheckoutDeltaMinutesBinding(ctx context.Context, source ScanSettings) (int, error) {
	if source == nil {
		return 0, ErrSettingsNotConfigured
	}
	return source.PerStudentCheckoutDeltaMinutes(ctx)
}
func DailyCheckoutFromAllRoomsEnabledBinding(ctx context.Context, source ScanSettings) (bool, error) {
	if source == nil {
		return false, nil
	}
	return source.DailyCheckoutFromAllRoomsEnabled(ctx)
}
