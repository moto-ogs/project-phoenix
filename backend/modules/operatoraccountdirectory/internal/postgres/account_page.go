package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"

	"github.com/moto-ogs/project-phoenix/modules/operatoraccountdirectory/contract"
	"github.com/uptrace/bun"
)

type accountCursor struct {
	ScopeKey     uint64
	SchoolID     int64
	AccountID    int64
	InvitationID int64
	Number       int
}

// An anchor only carries row IDs, not a name, email or search term in a URL.
func accountPageCursor(scope contract.AccountScope, query contract.AccountPageQuery) (accountCursor, error) {
	rawCursor := query.Cursor
	query.Cursor = ""
	data, err := json.Marshal(struct {
		Scope contract.AccountScope
		Query contract.AccountPageQuery
	}{scope, query})
	if err != nil {
		return accountCursor{}, err
	}
	hash := fnv.New64a()
	_, _ = hash.Write(data)
	key := hash.Sum64()
	if rawCursor == "" {
		return accountCursor{ScopeKey: key, Number: 1}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(rawCursor)
	var cursor accountCursor
	if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.ScopeKey != key ||
		cursor.SchoolID <= 0 || cursor.Number < 2 || cursor.Number > 1_000_000_000 ||
		cursor.AccountID < 0 || cursor.InvitationID < 0 ||
		(cursor.AccountID == 0) == (cursor.InvitationID == 0) {
		return accountCursor{}, contract.ErrInvalidAccountCursor
	}
	return cursor, nil
}

const accountCandidates = `
WITH scope AS (
	SELECT id, name FROM platform.schools
	WHERE deleted_at IS NULL
		AND (? = 0 OR id = ?)
		AND (? = 0 OR organization_id = ?)
), candidates AS (
	SELECT at.tenant_id AS school_id, at.account_id, 0::bigint AS invitation_id,
		a.email, a.active, at.status, ''::text AS invitation_first, ''::text AS invitation_last,
		NULL::bigint AS invitation_role_id
	FROM scope JOIN auth.account_tenants AS at ON at.tenant_id = scope.id
	JOIN auth.accounts AS a ON a.id = at.account_id
	UNION ALL
	SELECT inv.tenant_id, 0, inv.id, inv.email, false, 'invited',
		COALESCE(inv.first_name, ''), COALESCE(inv.last_name, ''), inv.role_id
	FROM scope JOIN auth.invitation_tokens AS inv ON inv.tenant_id = scope.id
	WHERE inv.used_at IS NULL AND inv.expires_at > statement_timestamp()
		AND NOT EXISTS (
			SELECT 1 FROM auth.account_tenants AS existing
			JOIN auth.accounts AS a ON a.id = existing.account_id
			WHERE existing.tenant_id = inv.tenant_id AND existing.status = 'active'
				AND lower(a.email) = lower(inv.email)
		)
), named AS (
	SELECT c.*, scope.name AS school_name, person.id AS person_id,
		COALESCE(person.first_name, c.invitation_first) AS first_name,
		COALESCE(person.last_name, c.invitation_last) AS last_name
	FROM candidates AS c JOIN scope ON scope.id = c.school_id
	LEFT JOIN LATERAL (
		SELECT p.id, p.first_name, p.last_name FROM users.persons AS p
		WHERE p.tenant_id = c.school_id AND p.account_id = c.account_id AND p.deleted_at IS NULL
		ORDER BY p.updated_at DESC, p.id ASC LIMIT 1
	) AS person ON c.account_id <> 0
), filtered AS (
	SELECT * FROM named
	WHERE ? = '' OR strpos(lower(first_name || ' ' || last_name), lower(?)) > 0
		OR strpos(lower(email), lower(?)) > 0 OR strpos(lower(school_name), lower(?)) > 0
)
`

const accountRoles = `
LEFT JOIN LATERAL (
	SELECT COALESCE(string_agg(DISTINCT r.name, ', ' ORDER BY r.name), '') AS role_name,
		COALESCE(bool_or(lower(r.name) = 'admin' AND c.account_id <> 0), false) AS has_admin_role,
		COALESCE(bool_or(lower(r.name) = 'user' AND c.account_id <> 0), false) AS has_user_role
	FROM auth.roles AS r
	WHERE r.id = c.invitation_role_id OR r.id IN (
		SELECT ar.role_id FROM auth.account_roles AS ar
		WHERE ar.tenant_id = c.school_id AND ar.account_id = c.account_id
	)
) AS roles ON true
`

const accountCaregiver = `
LEFT JOIN LATERAL (
	SELECT s.id, s.tenant_id FROM users.staff_school_memberships AS s
	WHERE s.person_id = c.person_id AND s.deleted_at IS NULL ORDER BY s.id LIMIT 1
) AS staff ON true
LEFT JOIN LATERAL (
	SELECT t.id, t.role FROM users.teachers AS t
	WHERE t.staff_id = staff.id AND t.deleted_at IS NULL AND staff.tenant_id = c.school_id
	ORDER BY t.id LIMIT 1
) AS teacher ON true
`

// The primary key follows the table's case-insensitive locale sort. For
// equal values reproduce the old stable sort's underlying order, then add
// school and row IDs for a deterministic boundary (even for invitations).
const accountSortKeys = `
, ordered AS (
	SELECT c.*, normalize(lower(?), NFC) COLLATE "und-x-icu" AS primary_key,
		(CASE WHEN ? THEN '' ELSE c.school_name END) COLLATE "C" AS tie_school,
		(CASE WHEN ? AND c.invitation_id <> 0 THEN '' ELSE c.last_name END) COLLATE "C" AS tie_last,
		(CASE WHEN ? AND c.invitation_id <> 0 THEN '' ELSE c.first_name END) COLLATE "C" AS tie_first,
		(? AND c.person_id IS NULL) AS tie_no_person,
		(? AND c.invitation_id <> 0) AS tie_school_invitation,
		(c.invitation_id <> 0) AS tie_invited
	FROM filtered AS c ?
), anchor AS (
	SELECT * FROM ordered WHERE school_id = ? AND account_id = ? AND invitation_id = ?
), page AS MATERIALIZED (
	SELECT c.* FROM ordered AS c LEFT JOIN anchor AS a ON true
	WHERE NOT ? OR (
		c.primary_key ? a.primary_key OR (
			c.primary_key = a.primary_key AND
			(c.tie_school, c.tie_school_invitation, c.tie_no_person, c.tie_last, c.tie_first, c.tie_invited,
			 c.school_id, c.account_id, c.invitation_id) >
			(a.tie_school, a.tie_school_invitation, a.tie_no_person, a.tie_last, a.tie_first, a.tie_invited,
			 a.school_id, a.account_id, a.invitation_id)
		)
	)
	ORDER BY c.primary_key ?, c.tie_school, c.tie_school_invitation, c.tie_no_person,
		c.tie_last, c.tie_first, c.tie_invited, c.school_id, c.account_id, c.invitation_id
	LIMIT ?
)
`

const accountPageRows = `
SELECT totals.total, totals.anchor_exists, COALESCE(c.school_id, 0) AS school_id,
	totals.has_more, COALESCE(c.account_id, 0) AS account_id, COALESCE(c.invitation_id, 0) AS invitation_id,
	COALESCE(c.school_name, '') AS school_name, COALESCE(c.email, '') AS email,
	COALESCE(c.active, false) AS active, COALESCE(c.status, '') AS status,
	COALESCE(c.first_name, '') AS first_name, COALESCE(c.last_name, '') AS last_name,
	roles.role_name, roles.has_admin_role, roles.has_user_role,
	COALESCE(teacher.role, '') AS pedagogic_role, (teacher.id IS NOT NULL) AS has_caregiver
FROM (SELECT (SELECT count(*) FROM filtered) AS total,
	EXISTS (SELECT 1 FROM anchor) AS anchor_exists, (SELECT count(*) FROM page) > ? AS has_more) AS totals
LEFT JOIN (
	SELECT * FROM page ORDER BY primary_key ?, tie_school, tie_school_invitation, tie_no_person,
		tie_last, tie_first, tie_invited, school_id, account_id, invitation_id LIMIT ?
) AS c ON true
` + accountRoles + accountCaregiver + `
ORDER BY c.primary_key ?, c.tie_school, c.tie_school_invitation, c.tie_no_person, c.tie_last,
	c.tie_first, c.tie_invited, c.school_id, c.account_id, c.invitation_id
`

func accountSort(query contract.AccountPageQuery, school bool) (bun.Safe, bun.Safe, error) {
	switch query.Sort {
	case "":
		if school {
			return accountSort(contract.AccountPageQuery{Sort: "name"}, school)
		}
		return "c.school_name", "", nil
	case "schoolName":
		return "c.school_name", "", nil
	case "name":
		return "btrim(c.last_name || ' ' || c.first_name)", "", nil
	case "email":
		return "c.email", "", nil
	case "roleName":
		return "roles.role_name", accountRoles, nil
	case "pedagogicRole":
		return "COALESCE(teacher.role, '')", accountCaregiver, nil
	case "status":
		return "c.status", "", nil
	default:
		return "", "", contract.ErrInvalidAccountSort
	}
}

type Database func(context.Context) (bun.IDB, error)

type AccountDirectory struct {
	database Database
}

func New(database Database) AccountDirectory {
	return AccountDirectory{database: database}
}

// AccountPage selects the boundary before joining display-only roles and
// caregiver facts. A role-derived sort joins just that sort value earlier.
func (p AccountDirectory) AccountPage(ctx context.Context, scope contract.AccountScope, query contract.AccountPageQuery) (contract.AccountPage, error) {
	cursor, err := accountPageCursor(scope, query)
	if err != nil {
		return contract.AccountPage{}, err
	}
	rows, err := p.readAccountPageRows(ctx, scope, query, cursor)
	if err != nil {
		return contract.AccountPage{}, err
	}
	if len(rows) == 0 {
		return contract.AccountPage{}, errors.New("operator account page is missing its count")
	}
	if query.Cursor != "" && !rows[0].AnchorExists {
		return contract.AccountPage{}, contract.ErrInvalidAccountCursor
	}
	result := contract.AccountPage{
		Rows:  make([]contract.AccountRow, 0, min(len(rows), contract.AccountPageSize)),
		Total: rows[0].Total, Number: cursor.Number,
	}
	for _, row := range rows[:min(len(rows), contract.AccountPageSize)] {
		if row.SchoolID != 0 {
			result.Rows = append(result.Rows, row.AccountRow)
		}
	}
	if rows[0].HasMore {
		last := result.Rows[len(result.Rows)-1]
		cursor.SchoolID, cursor.AccountID, cursor.InvitationID = last.SchoolID, last.AccountID, last.InvitationID
		cursor.Number++
		raw, err := json.Marshal(cursor)
		if err != nil {
			return contract.AccountPage{}, err
		}
		result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return result, nil
}

type accountPageRow struct {
	contract.AccountRow `bun:",embed"`
	Total               int
	AnchorExists        bool
	HasMore             bool
}

func (p AccountDirectory) readAccountPageRows(ctx context.Context, scope contract.AccountScope, query contract.AccountPageQuery, cursor accountCursor) ([]accountPageRow, error) {
	school := scope.SchoolID != 0
	sort, joins, err := accountSort(query, school)
	if err != nil {
		return nil, err
	}
	db, err := p.database(ctx)
	if err != nil {
		return nil, err
	}
	direction, after := bun.Safe("ASC"), bun.Safe(">")
	if query.Descending {
		direction, after = "DESC", "<"
	}
	var rows []accountPageRow
	err = db.NewRaw(accountCandidates+accountSortKeys+accountPageRows,
		scope.SchoolID, scope.SchoolID, scope.OrganizationID, scope.OrganizationID,
		query.Search, query.Search, query.Search, query.Search,
		sort, school, school, school, school, school, joins,
		cursor.SchoolID, cursor.AccountID, cursor.InvitationID,
		query.Cursor != "", after,
		direction, contract.AccountPageSize+1, contract.AccountPageSize,
		direction, contract.AccountPageSize, direction,
	).Scan(ctx, &rows)
	if err != nil {
		return nil, fmt.Errorf("select operator accounts: %w", err)
	}
	return rows, nil
}
