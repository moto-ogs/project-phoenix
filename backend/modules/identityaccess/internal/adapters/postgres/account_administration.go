package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

// accountTenantActive is the only mapping status that grants access; an
// offboarded membership keeps its row with status 'inactive'.
const accountTenantActive = "active"

// The account administration predicates, as compile-time SQL so the
// architecture evaluator resolves the tables they read. They are the
// boundary that keeps a school administrator inside their own school: an
// account row itself carries no tenant.
const (
	accountVisibilityDeniedSQL = `FALSE`
	liveAccountSQL             = `"account".personal_data_erased_at IS NULL`
	accountVisibilityTenantSQL = `EXISTS (
		SELECT 1 FROM auth.account_tenants AS "account_tenant"
		WHERE "account_tenant".account_id = "account".id
		  AND "account_tenant".tenant_id = ?
		  AND "account_tenant".status = ?
	)`
)

// scopeAccounts applies the caller's visibility to an account read or write.
// The global visibility leaves the statement untouched; it is generic over
// the query kind because selects and updates carry the same predicate.
func scopeAccounts[Q interface{ Where(string, ...any) Q }](query Q, visibility domain.AccountVisibility) Q {
	switch visibility.Kind {
	case domain.AccountVisibilityDenied:
		return query.Where(accountVisibilityDeniedSQL)
	case domain.AccountVisibilityTenant:
		return query.Where(accountVisibilityTenantSQL, visibility.TenantID, accountTenantActive)
	default:
		return query
	}
}

type administeredAccountRow struct {
	ID           int64      `bun:"id"`
	Email        string     `bun:"email"`
	Username     *string    `bun:"username"`
	Active       bool       `bun:"active"`
	PasswordHash *string    `bun:"password_hash,scanonly"`
	CreatedAt    time.Time  `bun:"created_at"`
	UpdatedAt    time.Time  `bun:"updated_at"`
	LastLogin    *time.Time `bun:"last_login"`
}

func (r administeredAccountRow) toDomain() domain.ManagedAccountRecord {
	record := domain.ManagedAccountRecord{
		ID: r.ID, Email: r.Email, Active: r.Active,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, LastLogin: r.LastLogin,
	}
	if r.Username != nil {
		record.Username = *r.Username
	}
	if r.PasswordHash != nil {
		record.PasswordHash = *r.PasswordHash
	}
	return record
}

const administeredAccountColumns = `"account".id, "account".email, "account".username, "account".active,
	"account".password_hash, "account".created_at, "account".updated_at, "account".last_login`

func (s *Store) accountSelect(ctx context.Context) (*bun.SelectQuery, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	return db.NewSelect().TableExpr(`auth.accounts AS "account"`).
		ColumnExpr(administeredAccountColumns).
		Where(liveAccountSQL), nil
}

func (s *Store) FindAccountRecord(ctx context.Context, id int64) (domain.ManagedAccountRecord, bool, domain.OperationStats, error) {
	query, err := s.accountSelect(ctx)
	if err != nil {
		return domain.ManagedAccountRecord{}, false, domain.OperationStats{}, err
	}
	return scanAdministeredAccount(ctx, query.Where(`"account".id = ?`, id).Limit(1), "find account record")
}

func (s *Store) FindManageableAccountRecord(ctx context.Context, id int64, visibility domain.AccountVisibility) (domain.ManagedAccountRecord, bool, domain.OperationStats, error) {
	query, err := s.accountSelect(ctx)
	if err != nil {
		return domain.ManagedAccountRecord{}, false, domain.OperationStats{}, err
	}
	query = scopeAccounts(query.Where(`"account".id = ?`, id), visibility)
	return scanAdministeredAccount(ctx, query.Limit(1), "find manageable account record")
}

func scanAdministeredAccount(ctx context.Context, query *bun.SelectQuery, operation string) (domain.ManagedAccountRecord, bool, domain.OperationStats, error) {
	var rows []administeredAccountRow
	started := time.Now()
	err := query.Scan(ctx, &rows)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started), Rows: int64(len(rows))}
	if err != nil {
		return domain.ManagedAccountRecord{}, false, stats, fmt.Errorf("identity access postgres: %s: %w", operation, err)
	}
	if len(rows) == 0 {
		return domain.ManagedAccountRecord{}, false, stats, nil
	}
	return rows[0].toDomain(), true, stats, nil
}

func (s *Store) SetManageableAccountActive(ctx context.Context, id int64, active bool, visibility domain.AccountVisibility) (bool, domain.OperationStats, error) {
	db, err := s.database(ctx)
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	query := db.NewUpdate().
		Model((*administeredAccountRow)(nil)).
		ModelTableExpr(`auth.accounts AS "account"`).
		Set(`active = ?`, active).
		Where(`"account".id = ?`, id).
		Where(liveAccountSQL)
	return execManageableAccountWrite(ctx, scopeAccounts(query, visibility), "set manageable account active")
}

func execManageableAccountWrite(ctx context.Context, query *bun.UpdateQuery, operation string) (bool, domain.OperationStats, error) {
	started := time.Now()
	result, err := query.Exec(ctx)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return false, stats, fmt.Errorf("identity access postgres: %s: %w", operation, err)
	}
	stats.Rows, _ = result.RowsAffected()
	return stats.Rows > 0, stats, nil
}
