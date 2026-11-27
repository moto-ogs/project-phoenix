package api

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"

	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"
	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/realtime"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SettingsWrites are the settings side effects the API dispatches on a
// value change and the tenant settings operations.
type SettingsWrites struct {
	SideEffects configModels.SideEffectDispatcher
	Tenant      configModels.TenantOperationsService
}

// buildSettingsWrites binds the side effects of Facilities (the Schulhof and
// WC checkout switches), Care Plan (the booking authority) and the photo
// lifecycle (the feature toggle), and the tenant operations over them.
func buildSettingsWrites(
	env owners.RootEnvironment, settings owners.SettingsOwner, payroll settingsCompose.PayrollStatusGetter, yard FacilitiesYard,
	authority careplan.BookingAuthority, photos StudentPhotoFeatureToggle, visits studentpresence.PresenceCleanup, hub *realtime.Hub,
	classList importModels.ClassListConverter,
) (SettingsWrites, error) {
	schulhof, wc := facilitiesCompose.SettingHandlers(yard.Schulhof, yard.WC)
	withoutCarePlace := classListConversionSideEffects(settings.Service, classList)
	registry, err := settingsCompose.NewSideEffects(env.Observe.SettingsSideEffectFailure,
		withoutCarePlace[0], withoutCarePlace[1],
		settingsCompose.SettingSideEffect{Key: configModels.KeyCheckoutSchulhofEnabled, Handle: schulhof},
		settingsCompose.SettingSideEffect{Key: configModels.KeyCheckoutWCEnabled, Handle: wc},
		careWithdrawalSettingSideEffect(authority),
		attendanceLogSettingSideEffect(visits),
		settingsCompose.SettingSideEffect{Key: configModels.KeyStudentPhotosEnabled, Handle: photos.HandleFeatureToggle},
	)
	if err != nil {
		return SettingsWrites{}, err
	}
	return SettingsWrites{
		SideEffects: registry,
		Tenant:      settingsCompose.NewTenantOperations(settings.Service, payroll, settings.Rows, registry.Dispatch, owners.SettingsChangedNotifier(hub)),
	}, nil
}

// careWithdrawalSettingSideEffect applies a change of
// enrollment.bookings_authoritative through Care Plan's booking authority.
func careWithdrawalSettingSideEffect(authority careplan.BookingAuthority) settingsCompose.SettingSideEffect {
	return settingsCompose.SettingSideEffect{Key: configModels.KeyEnrollmentBookingsAuthoritative, Handle: func(ctx context.Context, _ int64, value any) (func(), error) {
		authoritative, ok := value.(bool)
		if !ok {
			return nil, nil
		}
		_, err := authority.ApplyBookingAuthoritySetting(ctx, timezone.TodayDate(), authoritative)
		if errors.Is(err, careplan.ErrBookingAuthorityBlocked) {
			return nil, &settingsModule.BookingAuthorityBlockedError{Reason: err}
		}
		return nil, err
	}}
}

func attendanceLogSettingSideEffect(visits studentpresence.PresenceCleanup) settingsCompose.SettingSideEffect {
	return settingsCompose.SettingSideEffect{Key: configModels.KeyAttendanceLogEnabled, Handle: func(ctx context.Context, _ int64, value any) (func(), error) {
		enabled, ok := value.(bool)
		if !ok {
			return nil, errors.New("attendance log setting must be boolean")
		}
		return nil, visits.ApplyAttendanceLogSetting(ctx, enabled)
	}}
}

// classListConversionSideEffects convert the school's class-list entries
// into children without an OGS place (#4803, ADR 0282) once the school keeps
// such children: its switch and the module Unterricht am Vormittag both on,
// whichever of the two the moto team sets last. It runs in the settings
// write's transaction, so a failed conversion keeps the switch where it was.
// Switching off converts nothing back.
func classListConversionSideEffects(settings interface {
	ResolveBoolForTenantInTx(context.Context, int64, string) (bool, error)
}, classList importModels.ClassListConverter) [2]settingsCompose.SettingSideEffect {
	convertWhenOn := func(other string) func(context.Context, int64, any) (func(), error) {
		return func(ctx context.Context, tenantID int64, value any) (func(), error) {
			on, ok := value.(bool)
			if !ok || !on {
				return nil, nil
			}
			// Re-read under the shared writer lock, bypassing any pre-write
			// snapshot or request-cache entry from this request.
			otherOn, err := settings.ResolveBoolForTenantInTx(ctx, tenantID, other)
			if err != nil || !otherOn {
				return nil, err
			}
			// The trail names the moto team member who switched the school on.
			actor := int64(sessiontoken.ClaimsFromCtx(ctx).ID)
			if actor <= 0 {
				return nil, errors.New("class list conversion: the switch has no acting account")
			}
			return nil, classList.ConvertClassListEntries(ctx, actor)
		}
	}
	return [2]settingsCompose.SettingSideEffect{
		{Key: configModels.KeyChildrenWithoutCarePlace, Handle: convertWhenOn(configModels.KeyModuleUnterrichtVormittag)},
		{Key: configModels.KeyModuleUnterrichtVormittag, Handle: convertWhenOn(configModels.KeyChildrenWithoutCarePlace)},
	}
}
