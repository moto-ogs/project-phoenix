package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/driver/pgdriver"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The roles a Träger gives its schools (#4810, ADR 0317). The Träger's own
// rows are reached only in the Träger transaction of that Träger (ADR 0105
// point 3); every statement names the Träger besides the policy. The copies
// are rows of auth.roles in the school of the tenant transaction.

// traegerRoleDB returns the Träger transaction of organizationID. A school,
// administrative or foreign Träger transaction is refused.
func traegerRoleDB(ctx context.Context, organizationID int64) (bun.IDB, error) {
	if organizationID <= 0 || tenant.TraegerTransactionFromContext(ctx) != organizationID {
		return nil, errors.New("identity access postgres: the Träger transaction of this Träger is required")
	}
	raw, present := tenant.TransactionFromContext(ctx)
	if !present {
		return nil, errors.New("identity access postgres: transaction is required")
	}
	switch tx := raw.(type) {
	case bun.Tx:
		return tx, nil
	case *bun.Tx:
		if tx != nil {
			return *tx, nil
		}
	}
	return nil, fmt.Errorf("identity access postgres: unsupported transaction %T", raw)
}

type traegerSchoolRoleRow struct {
	ID             int64     `bun:"id"`
	OrganizationID int64     `bun:"organization_id"`
	Name           string    `bun:"name"`
	Description    string    `bun:"description"`
	BaseRole       string    `bun:"base_role"`
	UpdatedAt      time.Time `bun:"updated_at"`
}

func (row traegerSchoolRoleRow) domain(permissionIDs []int64) domain.TraegerSchoolRole {
	if permissionIDs == nil {
		permissionIDs = []int64{}
	}
	return domain.TraegerSchoolRole{ID: row.ID, OrganizationID: row.OrganizationID, Name: row.Name, Description: row.Description,
		BaseRole: row.BaseRole, PermissionIDs: permissionIDs, UpdatedAt: row.UpdatedAt}
}

const traegerSchoolRoleColumns = `id, organization_id, name, description, base_role, updated_at`

type traegerRolePermissionRow struct {
	TraegerRoleID int64 `bun:"traeger_role_id"`
	PermissionID  int64 `bun:"permission_id"`
}

func (s *RoleStore) ListTraegerSchoolRoles(ctx context.Context, organizationID int64) ([]domain.TraegerSchoolRole, error) {
	db, err := traegerRoleDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []traegerSchoolRoleRow
	if err := db.NewRaw(`SELECT `+traegerSchoolRoleColumns+` FROM auth.traeger_school_roles
		WHERE organization_id = ? ORDER BY lower(name), id`, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("list traeger school roles: %w", err)
	}
	selections, err := traegerRoleSelections(ctx, db, organizationID, 0)
	if err != nil {
		return nil, err
	}
	roles := make([]domain.TraegerSchoolRole, 0, len(rows))
	for _, row := range rows {
		roles = append(roles, row.domain(selections[row.ID]))
	}
	return roles, nil
}

// traegerRoleSelections maps the Träger's roles (or the one role) to their
// permission IDs in ascending order.
func traegerRoleSelections(ctx context.Context, db bun.IDB, organizationID, roleID int64) (map[int64][]int64, error) {
	var rows []traegerRolePermissionRow
	if err := db.NewRaw(`SELECT traeger_role_id, permission_id FROM auth.traeger_school_role_permissions
		WHERE organization_id = ? AND (? = 0 OR traeger_role_id = ?)
		ORDER BY traeger_role_id, permission_id`, organizationID, roleID, roleID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("list traeger school role permissions: %w", err)
	}
	selections := make(map[int64][]int64)
	for _, row := range rows {
		selections[row.TraegerRoleID] = append(selections[row.TraegerRoleID], row.PermissionID)
	}
	return selections, nil
}

func (s *RoleStore) FindTraegerSchoolRole(ctx context.Context, organizationID, id int64, lock bool) (domain.TraegerSchoolRole, bool, error) {
	db, err := traegerRoleDB(ctx, organizationID)
	if err != nil {
		return domain.TraegerSchoolRole{}, false, err
	}
	var rows []traegerSchoolRoleRow
	if lock {
		err = db.NewRaw(`SELECT `+traegerSchoolRoleColumns+` FROM auth.traeger_school_roles
			WHERE organization_id = ? AND id = ? FOR UPDATE`, organizationID, id).Scan(ctx, &rows)
	} else {
		err = db.NewRaw(`SELECT `+traegerSchoolRoleColumns+` FROM auth.traeger_school_roles
			WHERE organization_id = ? AND id = ?`, organizationID, id).Scan(ctx, &rows)
	}
	if err != nil {
		return domain.TraegerSchoolRole{}, false, fmt.Errorf("find traeger school role: %w", err)
	}
	if len(rows) == 0 {
		return domain.TraegerSchoolRole{}, false, nil
	}
	selections, err := traegerRoleSelections(ctx, db, organizationID, id)
	if err != nil {
		return domain.TraegerSchoolRole{}, false, err
	}
	return rows[0].domain(selections[id]), true, nil
}

func (s *RoleStore) SaveTraegerSchoolRole(ctx context.Context, role domain.TraegerSchoolRole) (domain.TraegerSchoolRole, error) {
	db, err := traegerRoleDB(ctx, role.OrganizationID)
	if err != nil {
		return domain.TraegerSchoolRole{}, err
	}
	var rows []traegerSchoolRoleRow
	if role.ID == 0 {
		err = db.NewRaw(`INSERT INTO auth.traeger_school_roles (organization_id, name, description, base_role)
			VALUES (?, ?, ?, ?) RETURNING `+traegerSchoolRoleColumns,
			role.OrganizationID, role.Name, role.Description, role.BaseRole).Scan(ctx, &rows)
	} else {
		// updated_at is the trigger's; the answer returns it.
		err = db.NewRaw(`UPDATE auth.traeger_school_roles SET name = ?, description = ?, base_role = ?
			WHERE organization_id = ? AND id = ? RETURNING `+traegerSchoolRoleColumns,
			role.Name, role.Description, role.BaseRole, role.OrganizationID, role.ID).Scan(ctx, &rows)
	}
	if err != nil {
		return domain.TraegerSchoolRole{}, fmt.Errorf("save traeger school role: %w", traegerRoleNameConflict(err))
	}
	if len(rows) == 0 {
		return domain.TraegerSchoolRole{}, identityaccess.ErrTraegerSchoolRoleNotFound
	}
	stored := rows[0]
	if _, err := db.NewRaw(`DELETE FROM auth.traeger_school_role_permissions
		WHERE organization_id = ? AND traeger_role_id = ?`, stored.OrganizationID, stored.ID).Exec(ctx); err != nil {
		return domain.TraegerSchoolRole{}, fmt.Errorf("clear traeger school role permissions: %w", err)
	}
	var permissionIDs []int64
	if len(role.PermissionIDs) > 0 {
		// The catalog decides: an ID it does not hold is no row.
		if err := db.NewRaw(`INSERT INTO auth.traeger_school_role_permissions (organization_id, traeger_role_id, permission_id)
			SELECT ?, ?, permission.id FROM auth.permissions AS permission WHERE permission.id IN (?)
			ORDER BY permission.id RETURNING permission_id`,
			stored.OrganizationID, stored.ID, bun.List(role.PermissionIDs)).Scan(ctx, &permissionIDs); err != nil {
			return domain.TraegerSchoolRole{}, fmt.Errorf("store traeger school role permissions: %w", err)
		}
	}
	return stored.domain(permissionIDs), nil
}

// traegerRoleNameConflict turns the unique violation on a Träger role's name
// into ErrTraegerSchoolRoleNameTaken.
func traegerRoleNameConflict(err error) error {
	var postgresError pgdriver.Error
	if errors.As(err, &postgresError) && postgresError.IntegrityViolation() && postgresError.Field('n') == "uq_traeger_school_roles_name" {
		return fmt.Errorf("%w: %w", identityaccess.ErrTraegerSchoolRoleNameTaken, err)
	}
	return err
}

func (s *RoleStore) DeleteTraegerSchoolRole(ctx context.Context, organizationID, id int64) error {
	db, err := traegerRoleDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if _, err := db.NewRaw(`DELETE FROM auth.traeger_school_roles WHERE organization_id = ? AND id = ?`, organizationID, id).Exec(ctx); err != nil {
		return fmt.Errorf("delete traeger school role: %w", err)
	}
	return nil
}

func (s *RoleStore) PlatformRoleNameExists(ctx context.Context, organizationID int64, name string) (bool, error) {
	db, err := traegerRoleDB(ctx, organizationID)
	if err != nil {
		return false, err
	}
	var found bool
	if err := db.NewRaw(`SELECT EXISTS (SELECT FROM auth.roles AS role
		WHERE role.tenant_id IS NULL AND LOWER(role.name) = LOWER(?))`, name).Scan(ctx, &found); err != nil {
		return false, fmt.Errorf("find platform role name: %w", err)
	}
	return found, nil
}

func (s *RoleStore) SchoolPermissionCatalog(ctx context.Context, organizationID int64) ([]domain.ManagedPermission, error) {
	db, err := traegerRoleDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []permissionRow
	if err := db.NewRaw(`SELECT id, name, description, resource, action, created_at, updated_at
		FROM auth.permissions ORDER BY resource, action, id`).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("list permission catalog: %w", err)
	}
	permissions := make([]domain.ManagedPermission, 0, len(rows))
	for _, row := range rows {
		permissions = append(permissions, row.domain())
	}
	return permissions, nil
}

func (s *RoleStore) PlatformRolePermissionIDs(ctx context.Context, organizationID int64, roleName string) ([]int64, error) {
	db, err := traegerRoleDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	ids := []int64{}
	if err := db.NewRaw(`SELECT selection.permission_id FROM auth.role_permissions AS selection
		JOIN auth.roles AS role ON role.id = selection.role_id
		WHERE role.tenant_id IS NULL AND role.is_system = TRUE AND LOWER(role.name) = LOWER(?)
		ORDER BY selection.permission_id`, roleName).Scan(ctx, &ids); err != nil {
		return nil, fmt.Errorf("list platform role permissions: %w", err)
	}
	return ids, nil
}

type schoolRoleStateRow struct {
	RoleID        int64  `bun:"role_id"`
	Name          string `bun:"name"`
	TraegerRoleID *int64 `bun:"traeger_role_id"`
	Holders       int    `bun:"holders"`
}

func (s *RoleStore) SchoolRoleStates(ctx context.Context) ([]domain.SchoolRoleState, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	scope := s.scope(ctx)
	if scope.TenantID <= 0 {
		return nil, domain.ErrTenantRequired
	}
	var rows []schoolRoleStateRow
	if err := db.NewRaw(`SELECT role.id AS role_id, role.name, role.traeger_role_id,
			(SELECT COUNT(*) FROM auth.account_roles AS held
			 WHERE held.role_id = role.id AND held.tenant_id = role.tenant_id) AS holders
		FROM auth.roles AS role
		WHERE role.tenant_id = ?
		ORDER BY role.id`, scope.TenantID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("list school role states: %w", err)
	}
	states := make([]domain.SchoolRoleState, 0, len(rows))
	for _, row := range rows {
		states = append(states, domain.SchoolRoleState(row))
	}
	return states, nil
}

func (s *RoleStore) CountRoleInvitations(ctx context.Context, roleID int64) (int, error) {
	db, err := s.database(ctx)
	if err != nil {
		return 0, err
	}
	scope := s.scope(ctx)
	if scope.TenantID <= 0 {
		return 0, domain.ErrTenantRequired
	}
	var count int
	if err := db.NewRaw(`SELECT COUNT(*) FROM auth.invitation_tokens WHERE tenant_id = ? AND role_id = ?`,
		scope.TenantID, roleID).Scan(ctx, &count); err != nil {
		return 0, fmt.Errorf("count role invitations: %w", err)
	}
	return count, nil
}

func (s *RoleStore) ReleaseTraegerRoleCopy(ctx context.Context, roleID int64) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	scope := s.scope(ctx)
	if scope.TenantID <= 0 {
		return domain.ErrTenantRequired
	}
	if _, err := db.NewRaw(`UPDATE auth.roles SET traeger_role_id = NULL
		WHERE id = ? AND tenant_id = ? AND traeger_role_id IS NOT NULL`, roleID, scope.TenantID).Exec(ctx); err != nil {
		return fmt.Errorf("release traeger role copy: %w", err)
	}
	return nil
}
