package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// GuardianStudentAccessRecord is the access half of one relationship.
type GuardianStudentAccessRecord struct {
	TenantID       int64
	RelationshipID int64
	AccountID      *int64
	Permissions    json.RawMessage
}

// GuardianStudentAccessStore is Identity & Access's persistence surface for
// the guardian relationship owner command.
type GuardianStudentAccessStore interface {
	LockLiveGuardianAccount(context.Context, int64) (bool, error)
	GrantGuardianStudentAccess(context.Context, GuardianStudentAccessRecord) (domain.OperationStats, error)
	InsertGuardianStudentAccesses(context.Context, []domain.GuardianStudentAccessGrant) (domain.OperationStats, error)
	SetGuardianStudentPermissions(context.Context, int64, int64, json.RawMessage) (bool, domain.OperationStats, error)
}

// guardianStudentAccessDatabase resolves the caller's transaction for a
// command that names its school. A tenant transaction must be scoped to the
// same school; an administrative transaction writes the named one.
func (s *Store) guardianStudentAccessDatabase(ctx context.Context, tenantID int64, operation string) (bun.IDB, error) {
	if tenantID <= 0 {
		return nil, fmt.Errorf("identity access postgres: tenant is required to %s", operation)
	}
	if scoped := s.scope(ctx).TenantID; scoped > 0 && scoped != tenantID {
		return nil, fmt.Errorf("%w: %s", domain.ErrGuardianStudentAccessTenantMismatch, operation)
	}
	return s.database(ctx)
}

func guardianPermissionsJSON(permissions json.RawMessage) string {
	if len(permissions) == 0 {
		return "{}"
	}
	return string(permissions)
}

func (s *Store) GrantGuardianStudentAccess(ctx context.Context, record GuardianStudentAccessRecord) (domain.OperationStats, error) {
	db, err := s.guardianStudentAccessDatabase(ctx, record.TenantID, "grant guardian student access")
	if err != nil {
		return domain.OperationStats{}, err
	}
	started := time.Now()
	result, err := db.NewRaw(`INSERT INTO auth.guardian_student_access (tenant_id, relationship_id, account_id, permissions)
		VALUES (?, ?, ?, ?::jsonb)`,
		record.TenantID, record.RelationshipID, record.AccountID, guardianPermissionsJSON(record.Permissions)).Exec(ctx)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return stats, fmt.Errorf("identity access postgres: grant guardian student access: %w", err)
	}
	stats.Rows, _ = result.RowsAffected()
	return stats, nil
}

// InsertGuardianStudentAccesses inserts the access halves of many new
// relationships in one statement with the columns GrantGuardianStudentAccess
// writes. Every record names the same school; the account reference trigger
// runs per row as there.
func (s *Store) InsertGuardianStudentAccesses(ctx context.Context, records []domain.GuardianStudentAccessGrant) (domain.OperationStats, error) {
	if len(records) == 0 {
		return domain.OperationStats{}, nil
	}
	tenantID := records[0].TenantID
	relationships, accounts := make([]int64, len(records)), make([]int64, len(records))
	permissions := make([]string, len(records))
	for i, record := range records {
		if record.TenantID != tenantID {
			return domain.OperationStats{}, fmt.Errorf("%w: grant guardian student accesses", domain.ErrGuardianStudentAccessTenantMismatch)
		}
		relationships[i], permissions[i] = record.RelationshipID, guardianPermissionsJSON(record.Permissions)
		if record.AccountID != nil {
			accounts[i] = *record.AccountID
		}
	}
	db, err := s.guardianStudentAccessDatabase(ctx, tenantID, "grant guardian student accesses")
	if err != nil {
		return domain.OperationStats{}, err
	}
	started := time.Now()
	result, err := db.NewRaw(`INSERT INTO auth.guardian_student_access (tenant_id, relationship_id, account_id, permissions)
		SELECT ?, k.relationship_id, NULLIF(k.account_id, 0), k.permissions::jsonb
		FROM unnest(?::bigint[], ?::bigint[], ?::text[]) WITH ORDINALITY AS k(relationship_id, account_id, permissions, ord)
		ORDER BY k.ord`,
		tenantID, pgdialect.Array(relationships), pgdialect.Array(accounts), pgdialect.Array(permissions)).Exec(ctx)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return stats, fmt.Errorf("identity access postgres: grant guardian student accesses: %w", err)
	}
	stats.Rows, _ = result.RowsAffected()
	if stats.Rows != int64(len(records)) {
		return stats, fmt.Errorf("identity access postgres: grant guardian student accesses: %d of %d rows written", stats.Rows, len(records))
	}
	return stats, nil
}

func (s *Store) SetGuardianStudentPermissions(ctx context.Context, tenantID, relationshipID int64, permissions json.RawMessage) (bool, domain.OperationStats, error) {
	db, err := s.guardianStudentAccessDatabase(ctx, tenantID, "set guardian student permissions")
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	started := time.Now()
	result, err := db.NewRaw(`UPDATE auth.guardian_student_access SET permissions = ?::jsonb
		WHERE tenant_id = ? AND relationship_id = ?`,
		guardianPermissionsJSON(permissions), tenantID, relationshipID).Exec(ctx)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return false, stats, fmt.Errorf("identity access postgres: set guardian student permissions: %w", err)
	}
	stats.Rows, _ = result.RowsAffected()
	return stats.Rows > 0, stats, nil
}

// guardianCareNoticeRow is the parent step of one relationship (#7760).
type guardianCareNoticeRow struct {
	RelationshipID int64   `bun:"relationship_id"`
	Notified       bool    `bun:"notified"`
	PortalAccess   bool    `bun:"portal_access"`
	AccountActive  bool    `bun:"account_active"`
	PortalMember   bool    `bun:"portal_member"`
	Email          *string `bun:"email"`
	PortalLocale   *string `bun:"portal_locale"`
}

// guardianCareNoticesQuery reads the parent step of the relationships in one
// statement. parent_portal.access counts only as stored true, as the parent
// announcements read it. The account is a member of the school's parents
// portal when its mapping is active and it holds the guardian role there,
// the condition of the parents portal's sign-in (guardianMembershipsQuery).
// An erased account reads as inactive and without address.
const guardianCareNoticesQuery = `SELECT gsa.relationship_id, gsa.care_notice_sent_at IS NOT NULL AS notified,
		gsa.permissions @> '{"parent_portal.access": true}'::jsonb AS portal_access,
		COALESCE(a.active AND a.personal_data_erased_at IS NULL, false) AS account_active,
		EXISTS (SELECT 1 FROM auth.account_tenants at
			JOIN auth.account_roles ar ON ar.account_id = at.account_id AND ar.tenant_id = at.tenant_id
			JOIN auth.roles r ON r.id = ar.role_id AND LOWER(r.name) = 'guardian'
			WHERE at.account_id = gsa.account_id AND at.tenant_id = gsa.tenant_id AND at.status = 'active') AS portal_member,
		CASE WHEN a.personal_data_erased_at IS NULL THEN a.email END AS email, a.portal_locale
	FROM auth.guardian_student_access gsa
	LEFT JOIN auth.accounts a ON a.id = gsa.account_id
	WHERE gsa.tenant_id = ? AND gsa.relationship_id IN (?)
	ORDER BY gsa.relationship_id`

// guardianCareNoticesLockedQuery holds the access rows until the caller's
// transaction ends.
const guardianCareNoticesLockedQuery = guardianCareNoticesQuery + ` FOR SHARE OF gsa`

// ListGuardianCareNotices reads the parent step of the relationships of the
// school in scope in one statement. lock takes a share lock of the access
// rows until the caller's transaction ends: a concurrent permission change
// waits for the run, or the run reads it once committed.
func (s *Store) ListGuardianCareNotices(ctx context.Context, relationshipIDs []int64, lock bool) (map[int64]domain.GuardianCareNoticeState, error) {
	states := make(map[int64]domain.GuardianCareNoticeState, len(relationshipIDs))
	if len(relationshipIDs) == 0 {
		return states, nil
	}
	tenantID := s.scope(ctx).TenantID
	db, err := s.guardianStudentAccessDatabase(ctx, tenantID, "list guardian care notices")
	if err != nil {
		return nil, err
	}
	var rows []guardianCareNoticeRow
	if lock {
		err = db.NewRaw(guardianCareNoticesLockedQuery, tenantID, bun.List(relationshipIDs)).Scan(ctx, &rows)
	} else {
		err = db.NewRaw(guardianCareNoticesQuery, tenantID, bun.List(relationshipIDs)).Scan(ctx, &rows)
	}
	if err != nil {
		return nil, fmt.Errorf("identity access postgres: list guardian care notices: %w", err)
	}
	for _, row := range rows {
		state := domain.GuardianCareNoticeState{
			RelationshipID: row.RelationshipID, Notified: row.Notified, PortalAccess: row.PortalAccess,
			AccountActive: row.AccountActive, PortalMember: row.PortalMember,
		}
		if row.Email != nil {
			state.Email = *row.Email
		}
		if row.PortalLocale != nil {
			state.Locale = *row.PortalLocale
		}
		states[row.RelationshipID] = state
	}
	return states, nil
}

// bulkInviteAccountsLockQuery locks the accounts a bulk invitation may grant
// access to, in id order, in the mode the grant's restoration of a school
// mapping takes (EnsureActiveTenantMapping: FOR NO KEY UPDATE). Holding it
// from the start, the run never upgrades a weaker hold on an account; a run
// of another school that shares the account waits for this one. The lock
// still admits the KEY SHARE holds of the parent guards. Accounts are also
// found by the profiles' addresses at the moment of the lock, so an account
// registered after the run read the addresses is locked here, in order, and
// not later inside the loop.
const bulkInviteAccountsLockQuery = `SELECT id FROM auth.accounts
	WHERE (id IN (?) OR LOWER(email) IN (?)) AND personal_data_erased_at IS NULL
	ORDER BY id FOR NO KEY UPDATE`

// LockBulkInviteAccounts locks the accounts, by id and by address, until the
// caller's transaction ends.
func (s *Store) LockBulkInviteAccounts(ctx context.Context, accountIDs []int64, emails []string) error {
	if len(accountIDs) == 0 && len(emails) == 0 {
		return nil
	}
	if len(accountIDs) == 0 {
		accountIDs = []int64{0}
	}
	if len(emails) == 0 {
		emails = []string{""}
	}
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	var ids []int64
	if err := db.NewRaw(bulkInviteAccountsLockQuery, bun.List(accountIDs), bun.List(emails)).Scan(ctx, &ids); err != nil {
		return fmt.Errorf("identity access postgres: lock bulk invitation accounts: %w", err)
	}
	return nil
}

// guardianNoticeMembershipLockQuery pins the school's active mapping and the
// guardian role rows of the accounts: what portal_member reads (#7760). A
// revocation that removes the role and deactivates the mapping waits for the
// run; an account without them is not eligible and has nothing to pin. The
// grant later in the run writes neither row: it holds an active mapping
// FOR SHARE (held already) and inserts a missing role, leaving an existing
// one alone.
const guardianNoticeMembershipLockQuery = `SELECT at.account_id FROM auth.account_tenants at
	JOIN auth.account_roles ar ON ar.account_id = at.account_id AND ar.tenant_id = at.tenant_id
	JOIN auth.roles r ON r.id = ar.role_id AND LOWER(r.name) = 'guardian'
	WHERE at.account_id IN (?) AND at.tenant_id = ? AND at.status = 'active'
	ORDER BY at.account_id, ar.role_id FOR SHARE OF at, ar`

// LockGuardianNoticeMemberships pins the accounts' membership of the
// school's parents portal until the caller's transaction ends (#7760).
func (s *Store) LockGuardianNoticeMemberships(ctx context.Context, accountIDs []int64) error {
	if len(accountIDs) == 0 {
		return nil
	}
	tenantID := s.scope(ctx).TenantID
	db, err := s.guardianStudentAccessDatabase(ctx, tenantID, "lock guardian notice memberships")
	if err != nil {
		return err
	}
	var ids []int64
	if err := db.NewRaw(guardianNoticeMembershipLockQuery, bun.List(accountIDs), tenantID).Scan(ctx, &ids); err != nil {
		return fmt.Errorf("identity access postgres: lock guardian notice memberships: %w", err)
	}
	return nil
}

// MarkGuardianCareNoticesSent stamps the relationships of the school in
// scope whose care notice the caller's transaction queued. A stamp already
// set stays: it records the first notice.
func (s *Store) MarkGuardianCareNoticesSent(ctx context.Context, relationshipIDs []int64) error {
	if len(relationshipIDs) == 0 {
		return nil
	}
	tenantID := s.scope(ctx).TenantID
	db, err := s.guardianStudentAccessDatabase(ctx, tenantID, "mark guardian care notices sent")
	if err != nil {
		return err
	}
	_, err = db.NewRaw(`UPDATE auth.guardian_student_access SET care_notice_sent_at = `+databaseClock+`
		WHERE tenant_id = ? AND relationship_id IN (?) AND care_notice_sent_at IS NULL`,
		tenantID, bun.List(relationshipIDs)).Exec(ctx)
	if err != nil {
		return fmt.Errorf("identity access postgres: mark guardian care notices sent: %w", err)
	}
	return nil
}
