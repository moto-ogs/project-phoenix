package api

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/traegerportal"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// mountTraegerSchoolRoleRoutes serves the roles a Träger gives the staff of
// all its schools (#4810, ADR 0317) at /traeger/school-roles behind the
// Träger right „Einstellungen“. Identity & Access owns the roles and their
// copies; the root binds the schools of the Träger, the persons behind the
// accounts of a school and the two transactions.
func mountTraegerSchoolRoleRoutes(root chi.Router, organizations HolidayOrganizations, persons TraegerPersons, identity identityaccess.Owner) error {
	provider, ok := identity.(identityaccess.TraegerSchoolRoleProvider)
	if !ok {
		return errors.New("traeger school roles: Identity & Access serves no Träger roles")
	}
	if organizations == nil || persons == nil {
		return errors.New("traeger school roles: the schools and the persons are required")
	}
	roles, err := provider.TraegerSchoolRoles(identityaccess.TraegerSchoolRolePorts{
		Schools: traegerRoleSchools{organizations: organizations},
		Runtime: traegerRoleRuntime{},
		People:  traegerRolePeople{persons: persons},
	})
	if err != nil {
		return err
	}
	requireSettings := common.RequiresPermission(identityaccess.TraegerRightSettingsManage)
	root.Mount("/traeger/school-roles", traegerportal.NewSchoolRolesResource(roles, requireSettings).TraegerRouter(ProtectedTraegerRoutes))
	return nil
}

// traegerRoleRuntime opens a school's tenant transaction or the Träger
// transaction, never both at once (ADR 0105), and serializes the writes of
// one Träger's roles across them (ADR 0317).
type traegerRoleRuntime struct{ traegerDocumentRuntime }

func (traegerRoleRuntime) WithinExclusive(ctx context.Context, key string, fn func(context.Context) error) error {
	return tenant.WithinExclusive(ctx, key, fn)
}

// traegerRoleSchools lists the undeleted schools of the Träger by name.
type traegerRoleSchools struct {
	organizations HolidayOrganizations
}

func (s traegerRoleSchools) TraegerSchools(ctx context.Context, organizationID int64) ([]identityaccess.TraegerSchoolRoleSchool, error) {
	schools, err := s.organizations.ListSchoolsByOrganization(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	result := make([]identityaccess.TraegerSchoolRoleSchool, 0, len(schools))
	for _, school := range schools {
		if !school.IsDeleted() {
			result = append(result, identityaccess.TraegerSchoolRoleSchool{ID: school.ID.Int64(), Name: school.Name})
		}
	}
	slices.SortFunc(result, func(a, b identityaccess.TraegerSchoolRoleSchool) int {
		if order := strings.Compare(a.Name, b.Name); order != 0 {
			return order
		}
		return int(a.ID - b.ID)
	})
	return result, nil
}

// traegerRolePeople names the persons behind accounts of the school of the
// tenant transaction, as the People Directory keeps them.
type traegerRolePeople struct {
	persons TraegerPersons
}

func (p traegerRolePeople) AccountNames(ctx context.Context, accountIDs []int64) (map[int64]string, error) {
	names := make(map[int64]string, len(accountIDs))
	if len(accountIDs) == 0 {
		return names, nil
	}
	people, err := p.persons.ListPersonsByAccount(ctx, accountIDs)
	if err != nil {
		return nil, err
	}
	for _, person := range people {
		if person.AccountID == nil {
			continue
		}
		if name := strings.TrimSpace(person.FirstName + " " + person.LastName); name != "" {
			names[*person.AccountID] = name
		}
	}
	return names, nil
}
