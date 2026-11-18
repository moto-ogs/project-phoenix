package api

import (
	"context"
	"errors"

	organizationTenancyCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// requiredDetailSources binds the sources of the details the Träger still
// has to enter before its letters, notices and contracts go out (#7177): the
// schools of the Träger from Organisation & Tenancy, their module switches
// and the letterhead text from the settings, and whether the Träger has a
// bank account from Organisation & Tenancy.
func requiredDetailSources(organizations HolidayOrganizations, settings TraegerBrandingSettings, schoolSettings owners.MealAttendanceSchoolSettings) parentbilling.RequiredDetailSources {
	return parentbilling.RequiredDetailSources{
		Schools: parentBillingCareSchools{organizations: organizations}, Modules: schoolModuleSwitches{settings: schoolSettings},
		Sender: parentBillingLetterPost{settings: settings}, Accounts: organizationTenancyCompose.NewTraegerMasterData(),
	}
}

// schoolModuleSwitches reads the module switches of several schools in one
// batch read. The caller runs in its Träger transaction, whose row security
// hides the settings of the schools, so they are read in an administrative
// transaction of their own (ADR 0105).
type schoolModuleSwitches struct {
	settings owners.MealAttendanceSchoolSettings
}

var errSchoolSettingsMissing = errors.New("required details: no settings for a school of the Träger")

func (s schoolModuleSwitches) BookedModules(ctx context.Context, schoolIDs []int64) (parentbilling.TraegerModules, error) {
	keys := []string{configModels.KeyModuleVertraege, configModels.KeyModuleElternbeitraege, configModels.KeyModuleFerienbetreuung}
	snapshots, err := s.settings.ResolveManyForTenants(tenant.ContextWithoutTransaction(ctx), schoolIDs, keys)
	if err != nil {
		return parentbilling.TraegerModules{}, err
	}
	modules := parentbilling.TraegerModules{}
	for _, id := range schoolIDs {
		snapshot, ok := snapshots[id]
		if !ok {
			return parentbilling.TraegerModules{}, errSchoolSettingsMissing
		}
		booked := make(map[string]bool, len(keys))
		for _, key := range keys {
			if booked[key], err = snapshot.Bool(key); err != nil {
				return parentbilling.TraegerModules{}, err
			}
		}
		modules.Contracts = modules.Contracts || booked[configModels.KeyModuleVertraege]
		modules.CareBilling = modules.CareBilling || booked[configModels.KeyModuleElternbeitraege]
		modules.HolidayCare = modules.HolidayCare || booked[configModels.KeyModuleFerienbetreuung]
	}
	return modules, nil
}
