package me

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/settings"
)

// SchoolSettings resolves the request tenant's settings inside its tenant
// transaction: the tenant override, else the registry default.
type SchoolSettings interface {
	ResolveBool(ctx context.Context, key string) (bool, error)
	ResolveString(ctx context.Context, key string) (string, error)
}

// errSchoolSwitchesUnavailable marks a navigation that failed on its school
// switches; the cause stays out of the response.
var errSchoolSwitchesUnavailable = errors.New("school switches unavailable")

var schoolSwitchKeys = []string{
	settings.KeyParentNewsEnabled,
	settings.KeyGuardianParentInviteMode,
	settings.KeyTimetableDayStartTime,
	settings.KeyTimetableDayEndTime,
}

// loadSchoolSwitches resolves every switch in one batch. An unreadable setting
// fails the request instead of rendering a guessed value.
func loadSchoolSwitches(ctx context.Context, source SchoolSettings) (identityaccess.SchoolSwitches, error) {
	ctx, err := settings.PrefetchSettingsOrError(ctx, source, schoolSwitchKeys...)
	if err != nil {
		return identityaccess.SchoolSwitches{}, fmt.Errorf("resolve school switches: %w", err)
	}
	var switches identityaccess.SchoolSwitches
	if switches.ParentNewsEnabled, err = source.ResolveBool(ctx, settings.KeyParentNewsEnabled); err != nil {
		return identityaccess.SchoolSwitches{}, fmt.Errorf("resolve %s: %w", settings.KeyParentNewsEnabled, err)
	}
	stringFields := []struct {
		key    string
		target *string
	}{
		{settings.KeyGuardianParentInviteMode, &switches.ParentInviteMode},
		{settings.KeyTimetableDayStartTime, &switches.TimetableDayStartTime},
		{settings.KeyTimetableDayEndTime, &switches.TimetableDayEndTime},
	}
	for _, field := range stringFields {
		if *field.target, err = source.ResolveString(ctx, field.key); err != nil {
			return identityaccess.SchoolSwitches{}, fmt.Errorf("resolve %s: %w", field.key, err)
		}
	}
	return switches, nil
}
