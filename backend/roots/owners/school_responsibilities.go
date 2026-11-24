package owners

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	organizationCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// ResponsibilitySchoolSettings reads settings of several schools at once.
type ResponsibilitySchoolSettings interface {
	ResolveManyForTenants(ctx context.Context, tenantIDs []int64, keys []string) (map[int64]*configModel.SettingsSnapshot, error)
}

// responsibilityKeys names the setting of each area of responsibility
// (#4811).
var responsibilityKeys = map[organizationtenancy.ResponsibilityArea]string{
	organizationtenancy.ResponsibilityContracts: configModel.KeyResponsibilityContracts,
	organizationtenancy.ResponsibilityBilling:   configModel.KeyResponsibilityBilling,
	organizationtenancy.ResponsibilityStaff:     configModel.KeyResponsibilityStaff,
}

// NewSchoolResponsibilities builds who is responsible at the schools of a
// Träger (#4811): Organisation & Tenancy keeps the Schulträger and the
// Gemeinde of a school, the Settings Platform resolves which body each
// area names.
func NewSchoolResponsibilities(settings ResponsibilitySchoolSettings) organizationtenancy.SchoolResponsibilities {
	if settings == nil {
		panic("school responsibilities: the school settings are required")
	}
	return organizationCompose.NewSchoolResponsibilities(schoolResponsibilitySettings{settings: settings})
}

// schoolResponsibilitySettings binds the choices of the schools to the
// settings responsibility.*. The caller runs in its Träger transaction,
// whose row security hides the settings of the schools, so they are read in
// an administrative transaction of their own (ADR 0105), school override
// above Träger value above default (ADR 0086).
type schoolResponsibilitySettings struct {
	settings ResponsibilitySchoolSettings
}

func (s schoolResponsibilitySettings) SchoolResponsibilityChoices(ctx context.Context, schoolIDs []int64,
) (map[int64]map[organizationtenancy.ResponsibilityArea]organizationtenancy.SchoolResponsibilityChoice, error) {
	keys := make([]string, 0, len(responsibilityKeys))
	for _, area := range organizationtenancy.ResponsibilityAreas() {
		keys = append(keys, responsibilityKeys[area])
	}
	snapshots, err := s.settings.ResolveManyForTenants(tenant.ContextWithoutTransaction(ctx), schoolIDs, keys)
	if err != nil {
		return nil, err
	}
	result := make(map[int64]map[organizationtenancy.ResponsibilityArea]organizationtenancy.SchoolResponsibilityChoice, len(schoolIDs))
	for _, schoolID := range schoolIDs {
		snapshot, ok := snapshots[schoolID]
		if !ok {
			return nil, fmt.Errorf("school responsibilities: no settings for school %d", schoolID)
		}
		choices := make(map[organizationtenancy.ResponsibilityArea]organizationtenancy.SchoolResponsibilityChoice, len(responsibilityKeys))
		for area, key := range responsibilityKeys {
			body, err := snapshot.String(key)
			if err != nil {
				return nil, err
			}
			source, _, _, err := snapshot.Layer(key)
			if err != nil {
				return nil, err
			}
			choices[area] = organizationtenancy.SchoolResponsibilityChoice{
				Body: organizationtenancy.ResponsibleBody(body), Source: organizationtenancy.ResponsibilitySource(source),
			}
		}
		result[schoolID] = choices
	}
	return result, nil
}

// StaffEmployers binds the employer at the Einsatzorte of a staff record of
// the Träger (#4811) to the responsibilities of Organisation & Tenancy: the
// kind and the name of the school's Schulträger or Gemeinde where the
// responsibility "Personal" names it and its master data are stored. The
// Personalakte names it, the payroll file books its Einsatzorte apart
// (#8041).
type StaffEmployers struct {
	Responsible organizationtenancy.ResponsibleParties
}

func (b StaffEmployers) SchoolEmployers(ctx context.Context, organizationID int64, schoolIDs []int64) (map[int64]workforce.TraegerStaffEmployer, error) {
	parties, err := b.Responsible.ResponsibleParties(ctx, organizationID, organizationtenancy.ResponsibilityStaff, schoolIDs)
	if err != nil {
		return nil, err
	}
	employers := make(map[int64]workforce.TraegerStaffEmployer, len(parties))
	for schoolID, party := range parties {
		employers[schoolID] = workforce.TraegerStaffEmployer{Body: string(party.Kind), Name: party.Name}
	}
	return employers, nil
}

// CareContractIssuers binds the body that concludes the contracts of a
// school (#4811) to the responsibilities of Organisation & Tenancy: the
// school's Schulträger or Gemeinde where the settings name it and its
// master data are stored, in the caller's Träger transaction.
type CareContractIssuers struct {
	Responsible organizationtenancy.ResponsibleParties
}

func (b CareContractIssuers) SchoolIssuers(ctx context.Context, organizationID int64, schoolIDs []int64) (map[int64]carecontract.Issuer, error) {
	parties, err := b.Responsible.ResponsibleParties(ctx, organizationID, organizationtenancy.ResponsibilityContracts, schoolIDs)
	if err != nil {
		return nil, err
	}
	issuers := make(map[int64]carecontract.Issuer, len(parties))
	for schoolID, party := range parties {
		issuers[schoolID] = carecontract.Issuer{
			SenderText: party.SenderText(), ContactName: party.ContactName, ContactPhone: party.ContactPhone, ContactEmail: party.ContactEmail,
		}
	}
	return issuers, nil
}
