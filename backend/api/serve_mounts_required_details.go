package api

import (
	"context"
	"slices"

	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"

	organizationTenancyCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"
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
		Issuers: newParentBillingLetterheads(settings, schoolSettings), Contracts: parentBillingCareContracts{contracts: careContractCompose.NewContractVersions()},
	}
}

// schoolModuleSwitches reads the module switches of several schools in one
// batch read: a module counts once one of the schools books it, the rule of
// the Träger portal's lock (#6052). The caller runs in its Träger transaction, whose row security
// hides the settings of the schools, so they are read in an administrative
// transaction of their own (ADR 0105).
type schoolModuleSwitches struct {
	settings owners.MealAttendanceSchoolSettings
}

func (s schoolModuleSwitches) BookedModules(ctx context.Context, schoolIDs []int64) (parentbilling.TraegerModules, error) {
	booked, err := settingsModule.ModulesBookedByAnySchool(tenant.ContextWithoutTransaction(ctx), s.settings, schoolIDs)
	if err != nil {
		return parentbilling.TraegerModules{}, err
	}
	return parentbilling.TraegerModules{
		Contracts:   slices.Contains(booked, settingsModule.ModuleVertraege),
		CareBilling: slices.Contains(booked, settingsModule.ModuleElternbeitraege),
		HolidayCare: slices.Contains(booked, settingsModule.ModuleFerienbetreuung),
	}, nil
}
