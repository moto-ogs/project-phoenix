package settings

import (
	"context"
	"errors"
	"fmt"

	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// ModuleKey identifies one additional module of the module catalog (#4812).
// moto Basis is always included and has no key.
type ModuleKey = configModel.ModuleKey

// ModuleDefinition is one entry of the central module list.
type ModuleDefinition = configModel.ModuleDefinition

// The additional modules a school can book.
const (
	ModuleNFCAnwesenheit      = configModel.ModuleNFCAnwesenheit
	ModuleMittagessen         = configModel.ModuleMittagessen
	ModuleElternApp           = configModel.ModuleElternApp
	ModuleOnlineAnmeldung     = configModel.ModuleOnlineAnmeldung
	ModuleUnterrichtVormittag = configModel.ModuleUnterrichtVormittag
	ModuleDienstplan          = configModel.ModuleDienstplan
	ModuleZeiterfassung       = configModel.ModuleZeiterfassung
	ModulePersonalakte        = configModel.ModulePersonalakte
	ModuleTraegerUebersicht   = configModel.ModuleTraegerUebersicht
	ModuleFerienbetreuung     = configModel.ModuleFerienbetreuung
	ModuleVertraege           = configModel.ModuleVertraege
	ModuleElternbeitraege     = configModel.ModuleElternbeitraege
)

// LookupModule returns the definition of a module key.
func LookupModule(key ModuleKey) (ModuleDefinition, bool) { return configModel.LookupModule(key) }

// ModuleSettingKeys lists the setting key of every module switch, for a
// caller that batch-resolves them (PrefetchSettings, ResolveManyForTenant).
func ModuleSettingKeys() []string {
	modules := configModel.Modules()
	keys := make([]string, len(modules))
	for i, module := range modules {
		keys[i] = module.SettingKey
	}
	return keys
}

// ModuleDependencyError rejects a module switch that breaks a prerequisite.
type ModuleDependencyError = configModel.ModuleDependencyError

// ModuleNotBookedError reports that a school has not booked a module.
type ModuleNotBookedError = configModel.ModuleNotBookedError

// ErrUnknownModule reports a module key that is not in the module list.
var ErrUnknownModule = errors.New("unknown module")

// ModuleBookingReader is the settings access ModuleBooking needs: an
// explicit school's switch, read through the settings service and its
// request cache, never an environment variable.
type ModuleBookingReader interface {
	ResolveBoolForTenant(ctx context.Context, tenantID int64, key string) (bool, error)
}

// ModuleBooking answers whether a school booked a module. Routes, jobs and
// portals use it to treat a module that is not booked as removed (#4893,
// #4894, #4895). A failed read is an error, never "booked" or "not booked".
// It reads in a tenant transaction of its own, so it also serves callers
// outside the tenant middleware: the route lock before the request
// transaction, the scheduler, login and refresh of the portals, devices.
type ModuleBooking struct {
	reader ModuleBookingReader
}

// NewModuleBooking binds the helper to the settings service. A missing
// reader is a composition error.
func NewModuleBooking(reader ModuleBookingReader) (*ModuleBooking, error) {
	if reader == nil {
		return nil, errors.New("settings: ModuleBooking requires a settings reader")
	}
	return &ModuleBooking{reader: reader}, nil
}

// RequireForTenant returns a *ModuleNotBookedError for the first of modules
// school tenantID has not booked. Read errors and unknown module keys
// (ErrUnknownModule) pass through as errors.
func (b *ModuleBooking) RequireForTenant(ctx context.Context, tenantID int64, modules ...ModuleKey) error {
	for _, module := range modules {
		definition, ok := configModel.LookupModule(module)
		if !ok {
			return fmt.Errorf("%w: %q", ErrUnknownModule, module)
		}
		booked, err := b.reader.ResolveBoolForTenant(ctx, tenantID, definition.SettingKey)
		if err != nil {
			return err
		}
		if !booked {
			return &ModuleNotBookedError{TenantID: tenantID, Module: module}
		}
	}
	return nil
}

// ModuleBatchReader reads settings of several schools in one batch. The
// settings service serves it with ResolveManyForTenants, which joins an
// administrative transaction and never opens a school transaction.
type ModuleBatchReader interface {
	ResolveManyForTenants(ctx context.Context, tenantIDs []int64, keys []string) (map[int64]*configModel.SettingsSnapshot, error)
}

// ErrSchoolSwitchesMissing reports a batch read that left out a school.
var ErrSchoolSwitchesMissing = errors.New("settings: no module switches for a school")

// ModulesBookedByAnySchool lists, in catalog order, the modules at least
// one of the schools books. It is the rule for a session that spans the
// schools of a Träger (#6052): the switches stay per school, and a module
// counts for the Träger once one of its schools books it, as the parents
// portal stays open while one guardian school books Eltern-App (#4895).
// Without schools nothing is booked. A failed or incomplete read is an
// error, never a booking decision.
func ModulesBookedByAnySchool(ctx context.Context, reader ModuleBatchReader, schoolIDs []int64) ([]ModuleKey, error) {
	if len(schoolIDs) == 0 {
		return []ModuleKey{}, nil
	}
	snapshots, err := reader.ResolveManyForTenants(ctx, schoolIDs, ModuleSettingKeys())
	if err != nil {
		return nil, err
	}
	return modulesBookedIn(snapshots, schoolIDs)
}

// modulesBookedIn reduces the switches of the schools to the modules at
// least one of them books. Every school needs its snapshot.
func modulesBookedIn(snapshots map[int64]*configModel.SettingsSnapshot, schoolIDs []int64) ([]ModuleKey, error) {
	for _, schoolID := range schoolIDs {
		if snapshots[schoolID] == nil {
			return nil, fmt.Errorf("%w: school %d", ErrSchoolSwitchesMissing, schoolID)
		}
	}
	return BookedModules(func(key string) (bool, error) {
		for _, schoolID := range schoolIDs {
			booked, err := snapshots[schoolID].Bool(key)
			if err != nil || booked {
				return booked, err
			}
		}
		return false, nil
	})
}

// TraegerSchoolLister lists the undeleted schools of an active Träger. The
// root binds it to Organisation & Tenancy.
type TraegerSchoolLister interface {
	ListTraegerSchoolIDs(ctx context.Context, organizationID int64) ([]int64, error)
}

// TraegerModuleBooking answers which modules count as booked for a Träger
// (#6052): the modules at least one of its schools books
// (ModulesBookedByAnySchool). The Träger portal locks its routes and its
// navigation with it. Callers inside a Träger transaction hand in a context
// without it: the row security of that transaction hides the settings of
// the schools (ADR 0105).
type TraegerModuleBooking struct {
	schools TraegerSchoolLister
	reader  ModuleBatchReader
}

// NewTraegerModuleBooking binds the answer to the schools of a Träger and
// the batch read of the settings service. A missing source is a composition
// error.
func NewTraegerModuleBooking(schools TraegerSchoolLister, reader ModuleBatchReader) (*TraegerModuleBooking, error) {
	if schools == nil || reader == nil {
		return nil, errors.New("settings: TraegerModuleBooking requires the schools of a Träger and a settings reader")
	}
	return &TraegerModuleBooking{schools: schools, reader: reader}, nil
}

// BookedModules lists the modules that count as booked for the Träger, in
// catalog order. A failed read is an error, never a booking decision. It
// combines its two sources itself, the schools and their switches, like
// ModulesBookedByAnySchool for a caller that already holds the schools.
func (b *TraegerModuleBooking) BookedModules(ctx context.Context, organizationID int64) ([]ModuleKey, error) {
	schoolIDs, err := b.schools.ListTraegerSchoolIDs(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if len(schoolIDs) == 0 {
		return []ModuleKey{}, nil
	}
	snapshots, err := b.reader.ResolveManyForTenants(ctx, schoolIDs, ModuleSettingKeys())
	if err != nil {
		return nil, err
	}
	return modulesBookedIn(snapshots, schoolIDs)
}

// BookedModules lists the booked modules in catalog order from one batch
// of resolved settings, for a reader that already holds a snapshot.
func BookedModules(readBool func(key string) (bool, error)) ([]ModuleKey, error) {
	booked := []ModuleKey{}
	for _, module := range configModel.Modules() {
		ok, err := readBool(module.SettingKey)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", module.SettingKey, err)
		}
		if ok {
			booked = append(booked, module.Key)
		}
	}
	return booked, nil
}

// KeyChildrenWithoutCarePlace is the school's switch for children without an
// OGS place (#4803, ADR 0282).
const KeyChildrenWithoutCarePlace = configModel.KeyChildrenWithoutCarePlace

// ChildrenWithoutCarePlaceOn reports whether the school keeps children of a
// class without an OGS place as student records: its switch is on and the
// module Unterricht am Vormittag is booked. A read error stays an error.
func ChildrenWithoutCarePlaceOn(readBool func(key string) (bool, error)) (bool, error) {
	for _, key := range []string{configModel.KeyModuleUnterrichtVormittag, configModel.KeyChildrenWithoutCarePlace} {
		on, err := readBool(key)
		if err != nil {
			return false, fmt.Errorf("resolve %s: %w", key, err)
		}
		if !on {
			return false, nil
		}
	}
	return true, nil
}
