package owners

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/operatoraccountdirectory"
	"github.com/moto-ogs/project-phoenix/modules/operatoraccountdirectory/contract"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	organizationCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

type operatorAccountDirectory struct {
	source contract.AccountDirectory
}

// NewOperatorAccountDirectory binds the operator-only projection to the
// caller's administrative transaction. Provisioning owns scope validation.
func NewOperatorAccountDirectory() organizationtenancy.AccountDirectory {
	return operatorAccountDirectory{source: operatoraccountdirectory.New(organizationCompose.OperatorDatabase())}
}

func (d operatorAccountDirectory) ListAccountPage(ctx context.Context, scope organizationtenancy.AccountScope, query organizationtenancy.AccountPageQuery) (organizationtenancy.AccountPage, error) {
	if !tenant.IsAdminTx(ctx) {
		return organizationtenancy.AccountPage{}, errors.New("operator account directory requires an administrative transaction")
	}
	page, err := d.source.AccountPage(ctx, contract.AccountScope(scope), contract.AccountPageQuery(query))
	if errors.Is(err, contract.ErrInvalidAccountSort) || errors.Is(err, contract.ErrInvalidAccountCursor) {
		return organizationtenancy.AccountPage{}, &organizationtenancy.InvalidProvisioningDataError{Err: err}
	}
	if err != nil {
		return organizationtenancy.AccountPage{}, err
	}
	rows := make([]organizationtenancy.OrganizationAccount, 0, len(page.Rows))
	for _, row := range page.Rows {
		hasProfile, active := schoolmembership.CaregiverStatus(row.HasCaregiver, row.HasUserRole)
		rows = append(rows, organizationtenancy.OrganizationAccount{
			SchoolID: ident.ID(row.SchoolID), SchoolName: row.SchoolName,
			SchoolAccount: organizationtenancy.SchoolAccount{
				AccountID: ident.ID(row.AccountID), InvitationID: ident.ID(row.InvitationID),
				Email: row.Email, Active: row.Active, FirstName: row.FirstName, LastName: row.LastName,
				Status: row.Status, RoleName: row.RoleName, PedagogicRole: row.PedagogicRole,
				HasAdminRole: row.HasAdminRole, HasUserRole: row.HasUserRole,
				HasCaregiverProfile: hasProfile, IsActiveCaregiver: active,
			},
		})
	}
	return organizationtenancy.AccountPage{Rows: rows, Total: page.Total, Number: page.Number, NextCursor: page.NextCursor}, nil
}
